import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma/client";
import { listCategoriesForOwner } from "@/modules/catalog/menu-options.service";
import DashboardNav from "@/components/DashboardNav";
import { addCategoryAction, deleteCategoryAction, moveCategoryAction, renameCategoryAction, toggleCategoryAction } from "./actions";
import styles from "../catalog.module.css";

export const dynamic = "force-dynamic";

/**
 * Categories for ANY business that sells products — Burgers / Drinks, Snacks
 * / Household, Shirts / Accessories. Nothing here knows what kind of shop
 * this is; the merchant names the groups. Reuses ProductCategory and the
 * catalogue permission.
 */
export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ saved?: string; err?: string }> }) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;
  let permitted = true;
  try {
    await requireStaffPermission("canManageServices");
  } catch {
    permitted = false;
  }
  const categories = permitted ? await listCategoriesForOwner(session.tenantId) : [];
  const counts = permitted
    ? Object.fromEntries((await prisma.product.groupBy({ by: ["categoryId"], where: { businessId: session.tenantId }, _count: { _all: true } })).map((r) => [r.categoryId ?? "", r._count._all]))
    : {};

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Categories</h1>
        <DashboardNav current="catalog" {...workspaceContext} />
        {sp.saved && <div className="successBanner">Saved.</div>}
        {sp.err && <div className="errorBanner">{sp.err}</div>}

        {!permitted ? (
          <div className={`card ${styles.section}`}><p>Your role doesn&apos;t have permission to manage the catalogue — ask the business owner.</p></div>
        ) : (
          <>
            <section className={styles.section}>
              <p className={styles.sub}>Group your items the way customers shop for them. Hidden categories keep their items but don&apos;t show as a group on your storefront.</p>
              {categories.length === 0 && <p className={styles.empty}>No categories yet. Items without a category still show on your storefront.</p>}
              <ul className={styles.list}>
                {categories.map((c, i) => (
                  <li key={c.id} className={`card ${styles.item}`} data-inactive={!c.isActive} style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span className={styles.itemName}>
                        {c.name} <span style={{ opacity: 0.7, fontWeight: 400 }}>· {counts[c.id] ?? 0} item{(counts[c.id] ?? 0) === 1 ? "" : "s"}{c.isActive ? "" : " · hidden"}</span>
                      </span>
                    </div>
                    <form action={renameCategoryAction.bind(null, c.id)} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input className="input" name="name" defaultValue={c.name} required maxLength={100} aria-label="Category name" style={{ flex: "1 1 160px" }} />
                      <input className="input" name="description" defaultValue={c.description ?? ""} maxLength={500} placeholder="Description (optional)" style={{ flex: "2 1 200px" }} />
                      <button type="submit" className="btn" style={{ minHeight: 44 }}>Save</button>
                    </form>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <form action={toggleCategoryAction.bind(null, c.id, !c.isActive)}><button type="submit" className="btn" style={{ minHeight: 44 }}>{c.isActive ? "Hide" : "Show"}</button></form>
                      {i > 0 && <form action={moveCategoryAction.bind(null, c.id, "UP")}><button type="submit" className="btn" style={{ minHeight: 44 }}>↑</button></form>}
                      {i < categories.length - 1 && <form action={moveCategoryAction.bind(null, c.id, "DOWN")}><button type="submit" className="btn" style={{ minHeight: 44 }}>↓</button></form>}
                      <form action={deleteCategoryAction.bind(null, c.id)}><button type="submit" className="btn" style={{ minHeight: 44 }}>Delete</button></form>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Add a category</h2>
              <form action={addCategoryAction} style={{ display: "grid", gap: 8 }}>
                <div className="field"><label className="label" htmlFor="new-name">Name</label><input className="input" id="new-name" name="name" required maxLength={100} placeholder="e.g. Drinks" /></div>
                <div className="field"><label className="label" htmlFor="new-desc">Description (optional)</label><input className="input" id="new-desc" name="description" maxLength={500} /></div>
                <button type="submit" className="btn btnPrimary" style={{ minHeight: 44 }}>Add category</button>
              </form>
              <p className={styles.sub}>Assign items to a category from each item&apos;s Edit form in your catalogue.</p>
            </section>
          </>
        )}
        <p><Link href="/dashboard/catalog">← Catalogue</Link></p>
      </div>
    </main>
  );
}
