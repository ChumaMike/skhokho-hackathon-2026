import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { listOptionGroupsForOwner } from "@/modules/catalog/menu-options.service";
import { getBusinessExperience } from "@/modules/tenant/business-experience";
import { formatZAR } from "@/lib/utils";
import DashboardNav from "@/components/DashboardNav";
import ActionButton from "@/components/ActionButton";
import ConfirmActionButton from "@/components/ConfirmActionButton";
import { Modal } from "@/components/ui/Modal";
import {
  addOptionGroup,
  editOptionGroup,
  toggleOptionGroupActive,
  removeOptionGroup,
  addOption,
  editOption,
  toggleOptionActive,
  removeOption,
} from "./actions";
import styles from "../catalog.module.css";

export const dynamic = "force-dynamic";

type OwnerOptionGroup = Awaited<ReturnType<typeof listOptionGroupsForOwner>>[number];

/** "Required · Select one" / "Optional · Select up to 4" / "Optional · Select any number" — merchant-friendly wording, never "modifier"/"entity" (§8). Required is derived from minSelections, never a separate stored flag (see the schema's own comment). */
function selectionSummary(group: Pick<OwnerOptionGroup, "selectionType" | "minSelections" | "maxSelections">): string {
  const required = group.minSelections >= 1 ? "Required" : "Optional";
  if (group.selectionType === "SINGLE") return `${required} · Select one`;
  if (group.maxSelections) return `${required} · Select up to ${group.maxSelections}`;
  return `${required} · Select any number`;
}

export default async function MenuOptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string; updated?: string; err?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;
  const experience = getBusinessExperience(workspaceContext.businessCategory);

  // §20/§21 — Retail/Salon/Mechanic must never reach a real Menu-options
  // editor, even via a guessed/bookmarked URL. Presentation gating here
  // mirrors the nav's own (admin-modules.ts never links here for a
  // non-Food business) — this is the direct-URL backstop.
  if (!experience.supportsMenuOptions) {
    return (
      <main className="shell">
        <div className="column">
          <span className="eyebrow">Skhokho</span>
          <h1 className={styles.title}>Customer choices</h1>
          <DashboardNav current="catalog" {...workspaceContext} />
          <div className={`card ${styles.empty}`} style={{ padding: 16 }}>
            <p>Customer choices are a Menu feature for food businesses.</p>
          </div>
        </div>
      </main>
    );
  }

  let permitted = true;
  try {
    await requireStaffPermission("canManageServices");
  } catch {
    permitted = false;
  }

  if (!permitted) {
    return (
      <main className="shell">
        <div className="column">
          <span className="eyebrow">Skhokho</span>
          <h1 className={styles.title}>Customer choices</h1>
          <DashboardNav current="catalog" {...workspaceContext} />
          <div className={`card ${styles.empty}`} style={{ padding: 16 }}>
            <p>Your role doesn&apos;t have permission to manage customer choices — ask the business owner.</p>
          </div>
        </div>
      </main>
    );
  }

  const groups = await listOptionGroupsForOwner(session.tenantId);

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Customer choices</h1>
        <p className={styles.sub}>
          Choices customers make when adding a {experience.itemSingular.toLowerCase()} — like size or extras. Attach a
          choice group to a {experience.itemSingular.toLowerCase()} from its own edit screen in {experience.catalogLabel}.
        </p>

        <DashboardNav current="catalog" {...workspaceContext} />

        {sp.added && <div className="successBanner">Added.</div>}
        {sp.updated && <div className="successBanner">Saved.</div>}
        {sp.err && <div className="errorBanner">{sp.err}</div>}

        {groups.length === 0 ? (
          <p className={styles.empty}>No choice groups yet. Add one to let customers pick a size, extras, or removals.</p>
        ) : (
          <ul className={styles.list}>
            {groups.map((group) => (
              <li key={group.id} className="card" data-inactive={!group.isActive} style={{ padding: "12px 14px" }}>
                <div className={styles.itemInfo} style={{ marginBottom: 8 }}>
                  <span className={styles.itemName}>{group.name}</span>
                  <span className={styles.itemPrice}>
                    {selectionSummary(group)}
                    {!group.isActive && " · Hidden from customers"}
                  </span>
                </div>

                {group.options.length > 0 && (
                  <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
                    {group.options.map((option) => (
                      <li
                        key={option.id}
                        style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", opacity: option.isActive ? 1 : 0.5 }}
                      >
                        <span>{option.name}</span>
                        <span className={styles.itemPrice}>
                          {Number(option.priceDelta) > 0 ? `+${formatZAR(option.priceDelta)}` : "+R0.00"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className={styles.itemActions}>
                  <Modal trigger="Edit" triggerClassName={styles.editBtn} title={`Edit ${group.name}`}>
                    <div className={styles.modalForm}>
                      <form action={editOptionGroup.bind(null, group.id)} className={styles.modalForm}>
                        <div className="field">
                          <label className="label" htmlFor={`group-name-${group.id}`}>
                            Choice group name
                          </label>
                          <input className="input" id={`group-name-${group.id}`} name="name" required maxLength={100} defaultValue={group.name} />
                        </div>
                        <div className="field">
                          <label className="label" htmlFor={`group-type-${group.id}`}>
                            How many can a customer pick?
                          </label>
                          <select
                            className="input"
                            id={`group-type-${group.id}`}
                            name="selectionType"
                            defaultValue={group.selectionType}
                          >
                            <option value="SINGLE">Just one (e.g. size)</option>
                            <option value="MULTIPLE">One or more (e.g. extras)</option>
                          </select>
                        </div>
                        <div className={styles.row}>
                          <div className="field">
                            <label className="label" htmlFor={`group-min-${group.id}`}>
                              Minimum required
                            </label>
                            <input
                              className="input"
                              id={`group-min-${group.id}`}
                              name="minSelections"
                              type="number"
                              min="0"
                              defaultValue={group.minSelections}
                            />
                          </div>
                          <div className="field">
                            <label className="label" htmlFor={`group-max-${group.id}`}>
                              Maximum allowed
                            </label>
                            <input
                              className="input"
                              id={`group-max-${group.id}`}
                              name="maxSelections"
                              type="number"
                              min="1"
                              placeholder="No limit"
                              defaultValue={group.maxSelections ?? undefined}
                            />
                          </div>
                        </div>
                        <button type="submit" className="btn btnPrimary">
                          Save choice group
                        </button>
                      </form>

                      <div>
                        <p className={styles.sub} style={{ margin: "8px 0" }}>
                          Options
                        </p>
                        {group.options.map((option) => (
                          <form
                            key={option.id}
                            action={editOption.bind(null, option.id)}
                            className={styles.row}
                            style={{ alignItems: "flex-end", marginBottom: 8 }}
                          >
                            <div className="field" style={{ marginBottom: 0 }}>
                              <label className="label" htmlFor={`option-name-${option.id}`}>
                                Name
                              </label>
                              <input className="input" id={`option-name-${option.id}`} name="name" required maxLength={100} defaultValue={option.name} />
                            </div>
                            <div className="field" style={{ marginBottom: 0, maxWidth: 110 }}>
                              <label className="label" htmlFor={`option-price-${option.id}`}>
                                Extra (R)
                              </label>
                              <input
                                className="input"
                                id={`option-price-${option.id}`}
                                name="priceDelta"
                                type="number"
                                step="0.01"
                                min="0"
                                defaultValue={option.priceDelta.toString()}
                              />
                            </div>
                            <button type="submit" className={styles.toggleBtn} style={{ minWidth: 44 }}>
                              Save
                            </button>
                            <ActionButton
                              action={toggleOptionActive.bind(null, option.id, !option.isActive)}
                              className={styles.toggleBtn}
                            >
                              {option.isActive ? "Hide" : "Show"}
                            </ActionButton>
                            <ConfirmActionButton
                              action={removeOption.bind(null, option.id)}
                              className={styles.deleteBtn}
                              confirmClassName={styles.deleteConfirmBtn}
                              cancelClassName={styles.toggleBtn}
                              label="Delete"
                              pendingLabel="Deleting…"
                            />
                          </form>
                        ))}

                        <form action={addOption.bind(null, group.id)} className={styles.row} style={{ alignItems: "flex-end" }}>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label className="label" htmlFor={`new-option-name-${group.id}`}>
                              New option name
                            </label>
                            <input className="input" id={`new-option-name-${group.id}`} name="name" required maxLength={100} placeholder="e.g. Large" />
                          </div>
                          <div className="field" style={{ marginBottom: 0, maxWidth: 110 }}>
                            <label className="label" htmlFor={`new-option-price-${group.id}`}>
                              Extra (R)
                            </label>
                            <input className="input" id={`new-option-price-${group.id}`} name="priceDelta" type="number" step="0.01" min="0" placeholder="0.00" />
                          </div>
                          <button type="submit" className="btn btnPrimary" style={{ minHeight: 44 }}>
                            Add
                          </button>
                        </form>
                      </div>
                    </div>
                  </Modal>
                  <ActionButton
                    action={toggleOptionGroupActive.bind(null, group.id, !group.isActive)}
                    className={styles.toggleBtn}
                  >
                    {group.isActive ? "Hide" : "Show"}
                  </ActionButton>
                  <ConfirmActionButton
                    action={removeOptionGroup.bind(null, group.id)}
                    className={styles.deleteBtn}
                    confirmClassName={styles.deleteConfirmBtn}
                    cancelClassName={styles.toggleBtn}
                    label="Delete"
                    pendingLabel="Deleting…"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <Modal trigger="+ Add choice group" triggerClassName={styles.addToggle} title="Add choice group">
          <form action={addOptionGroup} className={styles.modalForm}>
            <div className="field">
              <label className="label" htmlFor="new-group-name">
                Choice group name
              </label>
              <input className="input" id="new-group-name" name="name" required maxLength={100} placeholder="e.g. Choose your size" />
            </div>
            <div className="field">
              <label className="label" htmlFor="new-group-type">
                How many can a customer pick?
              </label>
              <select className="input" id="new-group-type" name="selectionType" defaultValue="SINGLE">
                <option value="SINGLE">Just one (e.g. size)</option>
                <option value="MULTIPLE">One or more (e.g. extras)</option>
              </select>
            </div>
            <div className={styles.row}>
              <div className="field">
                <label className="label" htmlFor="new-group-min">
                  Minimum required
                </label>
                <input className="input" id="new-group-min" name="minSelections" type="number" min="0" defaultValue={0} />
              </div>
              <div className="field">
                <label className="label" htmlFor="new-group-max">
                  Maximum allowed
                </label>
                <input className="input" id="new-group-max" name="maxSelections" type="number" min="1" placeholder="No limit" />
              </div>
            </div>
            <button type="submit" className="btn btnPrimary">
              Add choice group
            </button>
          </form>
        </Modal>
      </div>
    </main>
  );
}
