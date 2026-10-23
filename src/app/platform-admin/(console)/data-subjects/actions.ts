"use server";

import { z } from "zod";
import { adminCommand } from "@/modules/platform-admin/command";
import { eraseCustomer } from "@/modules/privacy/data-subject.service";

const uuid = z.string().uuid();

/** Erase one customer at one business — reason required, audited, recorded as a data-subject request. */
export async function eraseCustomerAction(businessId: string, publicId: string, phone: string, fd: FormData) {
  const bid = uuid.parse(businessId);
  const pid = uuid.parse(publicId);
  // adminCommand appends ?ok= / ?err= itself, so the path carries no query; the admin looks the number up again afterwards.
  await adminCommand({ permission: "privacy.manage", path: "/platform-admin/data-subjects", okFlag: "erased" }, fd, async (admin, reason) => {
    const summary = await eraseCustomer(bid, pid, { type: "platform_admin", id: admin.adminId }, reason ?? "", phone);
    return { action: "customer_erased", resource: { type: "membership", id: pid }, businessId: bid, metadata: { ...summary } };
  });
}
