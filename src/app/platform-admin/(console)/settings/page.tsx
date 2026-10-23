import { adminPage } from "@/modules/platform-admin/page-guard";
import { can, ROLE_LABELS } from "@/modules/platform-admin/permissions";
import { listAdmins } from "@/modules/platform-admin/admins.service";
import { configStatus } from "@/modules/platform-admin/metrics";
import { Badge, Banner, KV, PageHeader, ReasonField, Section, Table, when } from "../ui";
import { resetAdminMfaAction, setAdminRoleAction } from "./actions";
import RecoveryCodes from "./RecoveryCodes";

export const dynamic = "force-dynamic";

const ROLES = ["SUPER_ADMIN", "OPERATIONS", "FINANCE", "SUPPORT"] as const;

/**
 * Settings: feature switches and configuration (read-only — they live in the
 * hosting environment, presence shown, never values), your own MFA, and for
 * super admins the admin team (roles, MFA resets).
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await adminPage("settings.view");
  const sp = await searchParams;
  const config = configStatus();
  const manage = can(admin.role, "admins.manage");
  const admins = manage ? await listAdmins() : [];
  const onOff = (b: boolean) => <Badge tone={b ? "ok" : "warn"}>{b ? "on" : "off"}</Badge>;

  return (
    <>
      <PageHeader title="Settings" sub="Switches are environment variables (set in the hosting dashboard), shown here read-only." />
      <Banner ok={sp.ok} err={sp.err} />
      <Section title="Feature switches">
        <KV
          items={[
            ["SKHOKHOLETHA_ENABLED", onOff(config.skhokholetha.network)],
            ["DRIVER_SIGNUP_ENABLED", onOff(config.skhokholetha.driverSignup)],
            ["DELIVERY_REQUESTS_ENABLED", onOff(config.skhokholetha.deliveryRequests)],
            ["DRIVER_APPROVALS_ENABLED", onOff(config.skhokholetha.driverApprovals)],
            ["Driver terms + privacy configured", onOff(config.skhokholetha.legalConfigured)],
            ["PAYMENTS_ALLOW_LIVE_VERIFICATION", onOff(config.livePaymentVerification)],
            ["BUDDY_EXTERNAL_AI", onOff(config.externalAi)],
            ["Email", onOff(config.email)],
          ]}
        />
      </Section>

      <Section title="Your account">
        <KV items={[["Signed in as", admin.email], ["Role", ROLE_LABELS[admin.role]], ["Two-step sign-in", "on (required for every admin)"]]} />
        <div style={{ marginTop: 10 }}>
          <RecoveryCodes />
        </div>
      </Section>

      {manage && (
        <Section title="Admin team">
          <Table
            head={["Admin", "Role", "MFA", "Unused recovery codes", "Last sign-in", "Change role", "Reset MFA"]}
            rows={admins.map((a) => {
              const self = a.user.id === admin.adminId;
              return [
                `${a.user.email}${a.user.isActive ? "" : " (deactivated)"}${self ? " (you)" : ""}`,
                ROLE_LABELS[a.role],
                a.mfaEnabledAt ? `on since ${when(a.mfaEnabledAt)}` : <Badge key="m" tone="warn">not set up</Badge>,
                a._count.recoveryCodes,
                when(a.user.lastLoginAt),
                self ? "—" : (
                  <form key="r" action={setAdminRoleAction.bind(null, a.id)} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <select className="input" name="role" defaultValue={a.role} style={{ maxWidth: 150 }}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                    <ReasonField placeholder="Reason" />
                    <button type="submit" className="btn">Save</button>
                  </form>
                ),
                self || !a.mfaEnabledAt ? "—" : (
                  <form key="m" action={resetAdminMfaAction.bind(null, a.id)} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <ReasonField placeholder="Why (e.g. lost phone, verified by call)" />
                    <button type="submit" className="btn">Reset MFA</button>
                  </form>
                ),
              ];
            })}
          />
          <p style={{ opacity: 0.75 }}>
            New admins start as Support. A role change or MFA reset ends that admin&apos;s sessions. You can&apos;t change your own role or reset your own MFA, and the last super admin can&apos;t be demoted.
          </p>
        </Section>
      )}
    </>
  );
}
