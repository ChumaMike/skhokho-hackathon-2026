import { requireOwnerSession, getStaffWorkspaceContext } from "../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { listProductsForOwner, listServicesForOwner } from "@/modules/catalog/catalog.service";
import {
  listCategoriesForOwner,
  listOptionGroupsForOwner,
  listAssignedGroupIdsByProduct,
} from "@/modules/catalog/menu-options.service";
import Link from "next/link";
import { getBusinessExperience } from "@/modules/tenant/business-experience";
import {
  getProductEditorProfile,
  getServiceEditorProfile,
  type ProductEditorProfile,
  type ServiceEditorProfile,
} from "@/modules/tenant/vertical-editor";
import {
  EditorSection,
  NameField,
  DescriptionField,
  MoneyField,
  NumberField,
  PhotoField,
  AvailabilityNote,
} from "@/components/catalog/EditorFields";
import { formatZAR } from "@/lib/utils";
import DashboardNav from "@/components/DashboardNav";
import ActionButton from "@/components/ActionButton";
import ConfirmActionButton from "@/components/ConfirmActionButton";
import { Modal } from "@/components/ui/Modal";
import {
  addProduct,
  addService,
  editProduct,
  editService,
  toggleProduct,
  setSoldOutToday,
  moveProductAction,
  toggleService,
  removeProduct,
  removeService,
} from "./actions";
import styles from "./catalog.module.css";

export const dynamic = "force-dynamic";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string; updated?: string; err?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;

  // Narrowest existing permission that actually gates every mutation on
  // this page already (addProduct/editProduct/etc. all require
  // canManageServices) — using the same one for reads keeps a single,
  // already-established boundary instead of inventing a new one. This is
  // the internal management catalogue only; the public storefront/discover
  // pages are unaffected — customers never go through this permission.
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
          <h1 className={styles.title}>Your catalogue</h1>
          <DashboardNav current="catalog" {...workspaceContext} />
          <div className={`card ${styles.empty}`}>
            <p>Your role doesn&apos;t have permission to view the catalogue — ask the business owner.</p>
          </div>
        </div>
      </main>
    );
  }

  const [products, services] = await Promise.all([
    listProductsForOwner(session.tenantId),
    listServicesForOwner(session.tenantId),
  ]);

  // Semantic/presentation only (Business Experience Registry + the Vertical
  // Editor Foundation on top of it, §18 of Phase 3) — Product/Service stay
  // the internal domain entities regardless of what a Food or Mechanic
  // business sees them called; see business-experience.ts's own comment.
  const experience = getBusinessExperience(workspaceContext.businessCategory);
  const productEditor = getProductEditorProfile(experience, workspaceContext.capabilities.has("ORDERS"));
  const serviceEditor = getServiceEditorProfile(experience, workspaceContext.capabilities.has("BOOKINGS"));

  // Food Menu Domain Foundation (Phase 4) §7/§20 — categories and option
  // groups are fetched (and their UI rendered) ONLY for a Food-experience
  // business; Retail/Salon/Mechanic never see these fields at all.
  const [categories, allOptionGroups, assignedGroupIdsByProduct] = experience.supportsMenuOptions
    ? await Promise.all([
        listCategoriesForOwner(session.tenantId),
        listOptionGroupsForOwner(session.tenantId),
        listAssignedGroupIdsByProduct(session.tenantId, products.map((p) => p.id)),
      ])
    : [[], [], new Map<string, string[]>()];

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Your catalogue</h1>

        <DashboardNav current="catalog" {...workspaceContext} />

        {sp.added && (
          <div className="successBanner">
            {sp.added === "product" ? `${experience.itemSingular} added.` : `${experience.serviceItemSingular} added.`}
          </div>
        )}
        {sp.updated && (
          <div className="successBanner">
            {sp.updated === "product" ? `${experience.itemSingular} updated.` : `${experience.serviceItemSingular} updated.`}
          </div>
        )}
        {sp.err && <div className="errorBanner">{sp.err}</div>}

        {workspaceContext.capabilities.has("PRODUCTS") && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{experience.catalogLabel}</h2>
          <p className={styles.sub}>
            <Link href="/dashboard/catalog/categories">Manage categories →</Link>
            {experience.supportsMenuOptions && (
              <>
                {" · "}
                <Link href="/dashboard/catalog/options">Manage customer choices (size, extras) →</Link>
              </>
            )}
          </p>
          {products.length === 0 ? (
            <p className={styles.empty}>
              No {experience.itemPlural.toLowerCase()} yet. Add your first one and it&apos;ll show up on your storefront.
            </p>
          ) : (
            <ul className={styles.list}>
              {products.map((product) => (
                <li key={product.id} className={`card ${styles.item}`} data-inactive={!product.isActive}>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemName}>{product.name}</span>
                    <span className={styles.itemPrice}>{formatZAR(product.price)}</span>
                    <AvailabilityNote
                      hint={
                        !product.isActive ? "Hidden from customers" : product.soldOut ? "Sold out today — back tomorrow" : productEditor.availability.onLabel
                      }
                    />
                  </div>
                  <div className={styles.itemActions}>
                    <ActionButton action={moveProductAction.bind(null, product.id, "up")} className={styles.toggleBtn}>
                      ↑
                    </ActionButton>
                    <ActionButton action={moveProductAction.bind(null, product.id, "down")} className={styles.toggleBtn}>
                      ↓
                    </ActionButton>
                    {product.isActive && (
                      <ActionButton action={setSoldOutToday.bind(null, product.id, !product.soldOut)} className={styles.toggleBtn}>
                        {product.soldOut ? "Back in stock" : "Sold out today"}
                      </ActionButton>
                    )}
                    <Link href={`/dashboard/content/create?source=PRODUCT&productId=${product.id}`} className={styles.editBtn}>
                      Content
                    </Link>
                    <Modal trigger="Edit" triggerClassName={styles.editBtn} title={`Edit ${product.name}`}>
                      <form action={editProduct.bind(null, product.id)} className={styles.modalForm}>
                        <ProductFields
                          editor={productEditor}
                          idPrefix={`edit-product-${product.id}`}
                          defaultName={product.name}
                          defaultPrice={product.price}
                          defaultDescription={product.description ?? undefined}
                          currentImageUrl={product.imageUrl}
                          isActive={product.isActive}
                          categories={categories}
                          defaultCategoryId={product.categoryId ?? undefined}
                          optionGroups={
                            experience.supportsMenuOptions
                              ? { all: allOptionGroups, assignedIds: assignedGroupIdsByProduct.get(product.id) ?? [] }
                              : undefined
                          }
                        />
                        <button type="submit" className="btn btnPrimary">
                          Save changes
                        </button>
                      </form>
                    </Modal>
                    <ActionButton
                      action={toggleProduct.bind(null, product.id, !product.isActive)}
                      className={styles.toggleBtn}
                    >
                      {product.isActive ? "Hide" : "Show"}
                    </ActionButton>
                    <ConfirmActionButton
                      action={removeProduct.bind(null, product.id)}
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

          <Modal trigger={`+ ${experience.addItemLabel}`} triggerClassName={styles.addToggle} title={experience.addItemLabel}>
            <form action={addProduct} className={styles.modalForm}>
              <ProductFields
                editor={productEditor}
                idPrefix="add-product"
                categories={categories}
                // Customer choices (option groups) can only be attached once
                // the product exists — assign them from the Edit form
                // right after adding it.
              />
              <button type="submit" className="btn btnPrimary">
                {experience.addItemLabel}
              </button>
            </form>
          </Modal>
        </section>
        )}

        {workspaceContext.capabilities.has("SERVICES") && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{experience.serviceCatalogLabel}</h2>
          {services.length === 0 ? (
            <p className={styles.empty}>
              No {experience.serviceItemPlural.toLowerCase()} yet. Add your first one and it&apos;ll show up on your storefront.
            </p>
          ) : (
            <ul className={styles.list}>
              {services.map((service) => (
                <li key={service.id} className={`card ${styles.item}`} data-inactive={!service.isActive}>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemName}>{service.name}</span>
                    <span className={styles.itemPrice}>
                      {formatZAR(service.price)}
                      {service.duration ? ` · ${service.duration} min` : ""}
                    </span>
                    <AvailabilityNote
                      hint={service.isActive ? serviceEditor.availability.onLabel : "Hidden from customers"}
                    />
                  </div>
                  <div className={styles.itemActions}>
                    <Modal trigger="Edit" triggerClassName={styles.editBtn} title={`Edit ${service.name}`}>
                      <form action={editService.bind(null, service.id)} className={styles.modalForm}>
                        <ServiceFields
                          editor={serviceEditor}
                          idPrefix={`edit-service-${service.id}`}
                          defaultName={service.name}
                          defaultPrice={service.price}
                          defaultDuration={service.duration ?? undefined}
                          defaultMaxBookings={service.maxBookings ?? undefined}
                          defaultDescription={service.description ?? undefined}
                          currentImageUrl={service.imageUrl}
                          isActive={service.isActive}
                        />
                        <button type="submit" className="btn btnPrimary">
                          Save changes
                        </button>
                      </form>
                    </Modal>
                    <ActionButton
                      action={toggleService.bind(null, service.id, !service.isActive)}
                      className={styles.toggleBtn}
                    >
                      {service.isActive ? "Hide" : "Show"}
                    </ActionButton>
                    <ConfirmActionButton
                      action={removeService.bind(null, service.id)}
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

          <Modal trigger={`+ ${experience.addServiceLabel}`} triggerClassName={styles.addToggle} title={experience.addServiceLabel}>
            <form action={addService} className={styles.modalForm}>
              <ServiceFields editor={serviceEditor} idPrefix="add-service" />
              <button type="submit" className="btn btnPrimary">
                {experience.addServiceLabel}
              </button>
            </form>
          </Modal>
        </section>
        )}
      </div>
    </main>
  );
}

/**
 * Sectioned per §9 (Vertical Editor Foundation) — Basic information /
 * Pricing / Photo / Availability. The Availability section is deliberately
 * informational only (no second checkbox): the existing Hide/Show action
 * next to each list item remains the one real toggle
 * (setProductActive/setServiceActive) — duplicating it inside this form
 * would mean two controls for one piece of state, exactly the kind of
 * divergence §13 says to avoid introducing without real need.
 */
function ProductFields({
  editor,
  idPrefix,
  defaultName,
  defaultPrice,
  defaultDescription,
  currentImageUrl,
  isActive,
  categories,
  defaultCategoryId,
  optionGroups,
}: {
  editor: ProductEditorProfile;
  idPrefix: string;
  defaultName?: string;
  defaultPrice?: string;
  defaultDescription?: string;
  currentImageUrl?: string | null;
  /** Omitted for the Add form — a new item doesn't have a status yet. */
  isActive?: boolean;
  /** Food Menu Domain Foundation §7 — undefined for a non-Food business (§20: Retail/Salon never see this field at all). */
  categories?: { id: string; name: string }[];
  defaultCategoryId?: string;
  /** undefined for a non-Food business, or for the Add form (a new product has no id to assign groups to yet). */
  optionGroups?: { all: { id: string; name: string; isActive: boolean }[]; assignedIds: string[] };
}) {
  return (
    <>
      <EditorSection heading={editor.basic.heading}>
        <NameField idPrefix={idPrefix} label={editor.basic.nameLabel} defaultValue={defaultName} />
        <DescriptionField idPrefix={idPrefix} label={editor.basic.descriptionLabel} defaultValue={defaultDescription} />
      </EditorSection>
      <EditorSection heading={editor.pricing.heading}>
        <MoneyField idPrefix={idPrefix} label={editor.pricing.priceLabel} defaultValue={defaultPrice} />
      </EditorSection>
      {categories && (
        <EditorSection heading="Category">
          <div className="field">
            <label className="label" htmlFor={`${idPrefix}-category`}>
              Category
            </label>
            <select className="input" id={`${idPrefix}-category`} name="categoryId" defaultValue={defaultCategoryId ?? ""}>
              <option value="">Uncategorised</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </EditorSection>
      )}
      {optionGroups && (
        <EditorSection heading="Customer choices">
          <input type="hidden" name="menuOptionsEnabled" value="1" />
          {optionGroups.all.length === 0 ? (
            <p className="label">No choice groups yet — add one from Customer choices first.</p>
          ) : (
            optionGroups.all.map((group) => (
              <label key={group.id} className="label" style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32 }}>
                <input
                  type="checkbox"
                  name="optionGroupIds"
                  value={group.id}
                  defaultChecked={optionGroups.assignedIds.includes(group.id)}
                />
                {group.name}
                {!group.isActive && " (hidden)"}
              </label>
            ))
          )}
        </EditorSection>
      )}
      <EditorSection heading={editor.media.heading}>
        <PhotoField
          idPrefix={idPrefix}
          label={editor.media.photoLabel}
          guidance={editor.media.guidance}
          currentImageUrl={currentImageUrl}
        />
      </EditorSection>
      <EditorSection heading={editor.availability.heading}>
        <AvailabilityNote
          hint={
            isActive === undefined
              ? `New ${editor.itemNoun.toLowerCase()}s are visible to customers as soon as you add them.`
              : isActive
                ? editor.availability.onLabel
                : "Hidden from customers"
          }
        />
        <AvailabilityNote hint={editor.availability.hint} />
      </EditorSection>
    </>
  );
}

function ServiceFields({
  editor,
  idPrefix,
  defaultName,
  defaultPrice,
  defaultDuration,
  defaultMaxBookings,
  defaultDescription,
  currentImageUrl,
  isActive,
}: {
  editor: ServiceEditorProfile;
  idPrefix: string;
  defaultName?: string;
  defaultPrice?: string;
  defaultDuration?: number;
  defaultMaxBookings?: number;
  defaultDescription?: string;
  currentImageUrl?: string | null;
  isActive?: boolean;
}) {
  return (
    <>
      <EditorSection heading={editor.basic.heading}>
        <NameField idPrefix={idPrefix} label={editor.basic.nameLabel} defaultValue={defaultName} />
        <DescriptionField idPrefix={idPrefix} label={editor.basic.descriptionLabel} defaultValue={defaultDescription} />
      </EditorSection>
      <EditorSection heading={editor.pricing.heading}>
        <MoneyField idPrefix={idPrefix} label={editor.pricing.priceLabel} defaultValue={defaultPrice} />
      </EditorSection>
      <EditorSection heading={editor.booking.heading}>
        <NumberField idPrefix={idPrefix} name="duration" label={editor.booking.durationLabel} placeholder="60" defaultValue={defaultDuration} />
        <NumberField
          idPrefix={idPrefix}
          name="maxBookings"
          label={editor.booking.maxBookingsLabel}
          placeholder="1"
          defaultValue={defaultMaxBookings}
        />
      </EditorSection>
      <EditorSection heading={editor.media.heading}>
        <PhotoField
          idPrefix={idPrefix}
          label={editor.media.photoLabel}
          guidance={editor.media.guidance}
          currentImageUrl={currentImageUrl}
        />
      </EditorSection>
      <EditorSection heading={editor.availability.heading}>
        <AvailabilityNote
          hint={
            isActive === undefined
              ? `New ${editor.itemNoun.toLowerCase()}s are visible to customers as soon as you add them.`
              : isActive
                ? editor.availability.onLabel
                : "Hidden from customers"
          }
        />
        <AvailabilityNote hint={editor.availability.hint} />
      </EditorSection>
    </>
  );
}
