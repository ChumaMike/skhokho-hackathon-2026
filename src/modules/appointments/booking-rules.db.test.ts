import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createAppointment } from "./appointment.service";
import { BookingRefusedError } from "./booking-rules";
import { setBusinessCapabilities } from "@/modules/tenant/capabilities";
import { setOperatingHours } from "@/modules/tenant/operating-hours";
import { registerCustomer } from "@/modules/customers/customer.service";

/** createAppointment refuses at the service: Bookings off, or a slot outside opening hours. */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const created: string[] = [];
let phoneSeq = 0;

/** Next week's Monday at `hour`:`minute` SAST — always in the future, always a Monday. */
function nextMondayAt(hour: number, minute = 0): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 8));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour - 2, minute, 0)); // SAST = UTC+2
}

async function salon(label: string) {
  const b = await prisma.business.create({
    data: { name: `Booking Rules ${label}`, slug: `booking-rules-${label}-${run}`, category: "SALON", status: "ACTIVE" },
    select: { id: true },
  });
  created.push(b.id);
  const service = await prisma.service.create({ data: { businessId: b.id, name: "Cut", price: 150, duration: 60 }, select: { id: true } });
  const reg = await registerCustomer(b.id, `082${String((Date.now() + phoneSeq++) % 10_000_000).padStart(7, "0")}`, "Thandi", "test");
  const membership = await prisma.membership.findUniqueOrThrow({ where: { publicId: reg.public_id }, select: { id: true } });
  return { id: b.id, serviceId: service.id, membershipId: membership.id };
}

test.after(async () => {
  await prisma.appointment.deleteMany({ where: { businessId: { in: created } } });
  await prisma.service.deleteMany({ where: { businessId: { in: created } } });
  await prisma.businessNotification.deleteMany({ where: { businessId: { in: created } } });
  // Memberships/visits/consents belong to the append-only identity core and are left in place (business rows stay for referential integrity).
});

test("a salon with no hours set books at any time; once hours exist, a slot outside them is refused", async () => {
  const s = await salon("hours");
  const book = (startTime: Date) => createAppointment(s.id, { membershipId: s.membershipId, serviceId: s.serviceId, startTime });
  const ok = await book(nextMondayAt(10));
  assert.ok(ok?.id);

  await setOperatingHours(s.id, {
    monday: { open: "09:00", close: "17:00" },
    tuesday: { open: "09:00", close: "17:00" },
    wednesday: { open: "09:00", close: "17:00" },
    thursday: { open: "09:00", close: "17:00" },
    friday: { open: "09:00", close: "17:00" },
    saturday: { closed: true },
    sunday: { closed: true },
  });
  await assert.rejects(book(nextMondayAt(16, 30)), (e: unknown) => e instanceof BookingRefusedError && e.code === "OUTSIDE_HOURS", "16:30 + 60 min runs past 17:00");
  await assert.rejects(book(nextMondayAt(7)), BookingRefusedError, "before opening");
  const inside = await book(nextMondayAt(11));
  assert.ok(inside?.id);
  assert.equal(await prisma.appointment.count({ where: { businessId: s.id } }), 2);
});

test("switching Bookings off refuses every booking, whatever the hours say", async () => {
  const s = await salon("module");
  await setBusinessCapabilities(s.id, ["SERVICES", "LOYALTY"]);
  await assert.rejects(
    createAppointment(s.id, { membershipId: s.membershipId, serviceId: s.serviceId, startTime: nextMondayAt(10) }),
    (e: unknown) => e instanceof BookingRefusedError && e.code === "BOOKINGS_OFF",
  );
  assert.equal(await prisma.appointment.count({ where: { businessId: s.id } }), 0);
});
