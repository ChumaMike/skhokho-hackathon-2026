"use server";

import { z } from "zod";
import type { PlatformAdminRole } from "@prisma/client";
import { adminCommand } from "@/modules/platform-admin/command";
import { setAdminRole } from "@/modules/platform-admin/admins.service";
import { resetAdminMfa } from "@/modules/platform-admin/mfa.service";
import { requestContext } from "@/modules/platform-admin/audit";

const id = z.string().min(1).max(64);
const ROLE = z.enum(["SUPER_ADMIN", "OPERATIONS", "FINANCE", "SUPPORT"]);

/** Super admins only: change another admin's role (their sessions end). */
export async function setAdminRoleAction(targetAdminId: string, fd: FormData) {
  const tid = id.parse(targetAdminId);
  await adminCommand({ permission: "admins.manage", path: "/platform-admin/settings" }, fd, async (admin) => {
    const role = ROLE.parse(fd.get("role")) as PlatformAdminRole;
    const r = await setAdminRole(admin.adminId, tid, role);
    return { action: "admin_role_changed", resource: { type: "platform_admin", id: tid }, metadata: r };
  });
}

/**
 * Super admins only, never yourself: clears another admin's authenticator and
 * recovery codes and ends their sessions; they enrol again at next sign-in.
 * mfa.service writes the audit event itself (inside the same transaction).
 */
export async function resetAdminMfaAction(targetAdminId: string, fd: FormData) {
  const tid = id.parse(targetAdminId);
  await adminCommand({ permission: "admins.manage", path: "/platform-admin/settings" }, fd, async (admin, reason) => {
    await resetAdminMfa(admin.adminId, tid, reason!, await requestContext());
    return { action: "admin_mfa_reset_confirmed", resource: { type: "platform_admin", id: tid } };
  });
}
