import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { hashPassword } from "@/modules/auth/auth.service";
import { listRecentNotifications, countUnreadNotifications, markAllNotificationsRead } from "@/modules/dashboard/notifications";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string) {
  const { business } = await createBusiness({
    name: `Notifications Test ${label}`,
    category: "FOOD_VENDOR" as never,
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `notifications-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  return business;
}

test.after(async () => {
  const businesses = await prisma.business.findMany({
    where: { name: { startsWith: "Notifications Test " } },
    select: { id: true },
  });
  for (const { id } of businesses) {
    await prisma.businessNotification.deleteMany({ where: { businessId: id } });
    await prisma.businessStaff.deleteMany({ where: { businessId: id } });
    await prisma.businessRole.deleteMany({ where: { businessId: id } });
    await prisma.businessSubscription.deleteMany({ where: { businessId: id } });
    await prisma.business.delete({ where: { id } });
  }
});

test("listRecentNotifications returns newest first and respects limit", async () => {
  const business = await makeBusiness("ordering");
  for (const title of ["First", "Second", "Third"]) {
    await prisma.businessNotification.create({
      data: { businessId: business.id, type: "new_order", title, message: "test" },
    });
    await new Promise((r) => setTimeout(r, 5)); // distinct createdAt ordering
  }

  const all = await listRecentNotifications(business.id);
  assert.deepEqual(all.map((n) => n.title), ["Third", "Second", "First"]);

  const limited = await listRecentNotifications(business.id, { limit: 2 });
  assert.deepEqual(limited.map((n) => n.title), ["Third", "Second"]);
});

test("countUnreadNotifications only counts isRead: false", async () => {
  const business = await makeBusiness("unread-count");
  await prisma.businessNotification.create({
    data: { businessId: business.id, type: "new_order", title: "Unread", message: "test" },
  });
  await prisma.businessNotification.create({
    data: { businessId: business.id, type: "new_order", title: "Read", message: "test", isRead: true },
  });

  assert.equal(await countUnreadNotifications(business.id), 1);
});

test("markAllNotificationsRead sets both isRead and readAt, and is tenant-scoped", async () => {
  const businessA = await makeBusiness("mark-read-a");
  const businessB = await makeBusiness("mark-read-b");
  await prisma.businessNotification.create({
    data: { businessId: businessA.id, type: "new_order", title: "A", message: "test" },
  });
  await prisma.businessNotification.create({
    data: { businessId: businessB.id, type: "new_order", title: "B", message: "test" },
  });

  await markAllNotificationsRead(businessA.id);

  const [aRows, bRows] = await Promise.all([
    prisma.businessNotification.findMany({ where: { businessId: businessA.id } }),
    prisma.businessNotification.findMany({ where: { businessId: businessB.id } }),
  ]);
  assert.equal(aRows[0]?.isRead, true);
  assert.ok(aRows[0]?.readAt instanceof Date);
  assert.equal(bRows[0]?.isRead, false, "a different business's rows must never be touched");
});
