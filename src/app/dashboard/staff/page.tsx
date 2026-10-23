import { requireOwnerOnlySession, getStaffWorkspaceContext } from "../session";
import { prisma } from "@/lib/prisma/client";
import { listStaff } from "@/modules/staff/staff.service";
import { getBusinessCapabilities } from "@/modules/tenant/capabilities";
import { STAFF_PRESETS, resolveCanonicalPreset } from "@/modules/staff/staff-presets";
import ActionButton from "@/components/ActionButton";
import StaffPresetPicker from "@/components/StaffPresetPicker";
import { Modal } from "@/components/ui/Modal";
import DashboardNav from "@/components/DashboardNav";
import { invite, resend, toggleStaffActive, changeStaffRole } from "./actions";
import styles from "./staff.module.css";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  MANAGER: "Manager",
  STAFF: "Staff",
  CASHIER: "Cashier",
  TECHNICIAN: "Technician",
};

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ invited?: string; roleChanged?: string; err?: string }>;
}) {
  const session = await requireOwnerOnlySession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;
  const [team, business] = await Promise.all([
    listStaff(session.tenantId),
    prisma.business.findUniqueOrThrow({
      where: { id: session.tenantId },
      select: { category: true, settings: true },
    }),
  ]);

  const capabilities = getBusinessCapabilities(business);
  const presetOptions = Object.values(STAFF_PRESETS)
    .filter((preset) => !preset.requiredCapability || capabilities.has(preset.requiredCapability))
    .map((preset) => ({
      id: preset.id,
      label: preset.label,
      jobTitle: preset.jobTitle,
      grants: preset.summary.grants,
      denies: preset.summary.denies,
      note: preset.summary.note,
    }));

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Your team</h1>
        <p className={styles.sub}>
          Team members log in separately from you, at{" "}
          <span className={styles.mono}>/staff-login</span>.
        </p>

        <DashboardNav current="staff" {...workspaceContext} />

        {sp.invited && <div className="successBanner">Invite sent.</div>}
        {sp.roleChanged && <div className="successBanner">Role updated.</div>}
        {sp.err && <div className="errorBanner">{sp.err}</div>}

        <ul className={styles.list}>
          {team.map((member) => {
            const currentPresetId = resolveCanonicalPreset({
              jobPreset: member.role?.jobPreset ?? null,
              presetRole: member.role?.presetRole ?? null,
            });
            const currentPreset = currentPresetId ? STAFF_PRESETS[currentPresetId] : null;

            return (
              <li key={member.id} className={`card ${styles.item}`} data-inactive={!member.isActive}>
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>
                    {member.firstName} {member.lastName}
                    {member.isOwner && <span className={styles.ownerBadge}>Owner</span>}
                  </span>
                  <span className={styles.itemMeta}>
                    {member.email} · {member.jobTitle || ROLE_LABELS[member.staffRole] || member.staffRole}
                    {member.resetToken && !member.isOwner ? " · invite pending" : ""}
                  </span>
                  {!member.isOwner && currentPreset && (
                    <div className={styles.permissionSummary}>
                      {currentPreset.summary.grants.map((grant) => (
                        <span key={grant} className={styles.permissionGrant}>
                          {grant}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {!member.isOwner && (
                  <div className={styles.itemActions}>
                    {member.resetToken && (
                      <ActionButton
                        action={resend.bind(null, member.id)}
                        className={styles.secondaryBtn}
                        pendingLabel="Sending…"
                      >
                        Resend invite
                      </ActionButton>
                    )}
                    <Modal trigger="Change role" triggerClassName={styles.secondaryBtn} title={`Change ${member.firstName}'s role`}>
                      <form action={changeStaffRole} className={styles.modalForm}>
                        <input type="hidden" name="staffId" value={member.id} />
                        <StaffPresetPicker
                          options={presetOptions}
                          defaultId={currentPresetId ?? undefined}
                          defaultJobTitle={member.jobTitle ?? undefined}
                        />
                        <button type="submit" className="btn btnPrimary">
                          Save role
                        </button>
                      </form>
                    </Modal>
                    <ActionButton
                      action={toggleStaffActive.bind(null, member.id, !member.isActive)}
                      className={styles.secondaryBtn}
                    >
                      {member.isActive ? "Deactivate" : "Reactivate & send invite"}
                    </ActionButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <Modal trigger="+ Add a team member" triggerClassName={styles.addToggle} title="Add a team member">
          <form action={invite} className={styles.modalForm}>
            <div className={styles.row}>
              <div className="field">
                <label className="label" htmlFor="firstName">
                  First name
                </label>
                <input className="input" id="firstName" name="firstName" required maxLength={100} />
              </div>
              <div className="field">
                <label className="label" htmlFor="lastName">
                  Last name
                </label>
                <input className="input" id="lastName" name="lastName" required maxLength={100} />
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="email">
                Email
              </label>
              <input className="input" id="email" name="email" type="email" required />
            </div>

            <StaffPresetPicker options={presetOptions} />

            <button type="submit" className="btn btnPrimary">
              Send invite
            </button>
          </form>
        </Modal>
      </div>
    </main>
  );
}
