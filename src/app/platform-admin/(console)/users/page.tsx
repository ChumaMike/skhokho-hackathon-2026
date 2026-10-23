import type { AppRole } from "@prisma/client";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { prisma } from "@/lib/prisma/client";
import { ROLE_LABELS } from "@/modules/platform-admin/permissions";
import { Badge, Filters, PageHeader, Section, Table, when } from "../ui";

export const dynamic = "force-dynamic";

const ROLES = ["ALL", "OWNER", "ADMIN", "DRIVER", "STAFF", "AGENT"] as const;

/**
 * Platform accounts (app users): owners, admins, drivers, internal staff.
 * Customers are NOT app users — their identities are never listed here.
 * Never shown: password hashes, reset tokens, MFA material.
 */
export default async function UsersPage({ searchParams }: { searchParams: Promise<{ role?: string; q?: string }> }) {
  await adminPage("users.view");
  const sp = await searchParams;
  const role = (ROLES as readonly string[]).includes(sp.role ?? "") ? (sp.role as (typeof ROLES)[number]) : "ALL";
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 80);
  const users = await prisma.appUser.findMany({
    where: { ...(role === "ALL" ? {} : { role: role as AppRole }), ...(q ? { email: { contains: q } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { ownedBusinesses: true } },
      driverProfile: { select: { verificationStatus: true } },
      platformAdmin: { select: { role: true, mfaEnabledAt: true } },
    },
  });

  return (
    <>
      <PageHeader title="Users" sub="Platform accounts only (customers are not listed). Newest first, 50 at a time." />
      <form method="get" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input className="input" name="q" defaultValue={q} placeholder="Search email" />
        <input type="hidden" name="role" value={role} />
        <button type="submit" className="btn">Search</button>
      </form>
      <Filters base="/platform-admin/users" param="role" current={role} keep={{ q: q || undefined }} options={ROLES.map((r) => ({ value: r, label: r === "ALL" ? "All" : r.toLowerCase() }))} />
      <Section title={`${users.length} shown`}>
        <Table
          head={["Email", "Role", "Status", "Email confirmed", "Businesses", "Driver", "Admin", "Last sign-in", "Created"]}
          rows={users.map((u) => [
            u.email,
            u.role.toLowerCase(),
            <Badge key="a" tone={u.isActive ? "ok" : "bad"}>{u.isActive ? "active" : "deactivated"}</Badge>,
            u.emailVerifiedAt ? "yes" : "no",
            u._count.ownedBusinesses,
            u.driverProfile?.verificationStatus.toLowerCase() ?? "",
            u.platformAdmin ? `${ROLE_LABELS[u.platformAdmin.role]}${u.platformAdmin.mfaEnabledAt ? " · MFA" : " · no MFA yet"}` : "",
            when(u.lastLoginAt),
            when(u.createdAt),
          ])}
        />
      </Section>
    </>
  );
}
