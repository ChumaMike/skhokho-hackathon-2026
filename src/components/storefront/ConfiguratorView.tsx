"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatZAR } from "@/lib/utils";
import { useCart } from "@/lib/storefront/useCart";
import viewStyles from "@/components/StorefrontView.module.css";
import styles from "./ConfiguratorView.module.css";

export interface ConfiguratorOption {
  id: string;
  name: string;
  priceDelta: string;
}

export interface ConfiguratorOptionGroup {
  id: string;
  name: string;
  selectionType: "SINGLE" | "MULTIPLE";
  minSelections: number;
  maxSelections: number | null;
  options: ConfiguratorOption[];
}

export interface ConfiguratorProduct {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: string;
}

/**
 * Food Menu Domain Foundation §10/§23 — the accessible item-configuration
 * flow. Mobile-first (one column, large radio/checkbox rows, the running
 * total pinned near the Add button so it never scrolls out of view) but
 * not mobile-only per the cross-cutting Responsive Experience Principle:
 * at wider viewports the content column simply keeps its own comfortable
 * reading width (`--column-max` from globals.css) rather than stretching a
 * form meant to be filled in quickly.
 *
 * Client-side selection here is a UX convenience only (§14) — nothing here
 * is trusted. The real validation (group membership, active status,
 * min/max, price deltas) happens again, from scratch, in
 * resolveStorefrontCartQuote once this line reaches Basket/Checkout.
 */
export default function ConfiguratorView({
  businessId,
  basePath,
  product,
  optionGroups,
}: {
  businessId: string;
  basePath: string;
  product: ConfiguratorProduct;
  optionGroups: ConfiguratorOptionGroup[];
}) {
  const cart = useCart(businessId);
  const router = useRouter();
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const unsatisfiedGroups = useMemo(
    () => optionGroups.filter((g) => g.minSelections > 0 && (selections[g.id]?.length ?? 0) < g.minSelections),
    [optionGroups, selections],
  );

  const configuredUnitPrice = useMemo(() => {
    const deltaSum = optionGroups.reduce((sum, group) => {
      const selectedIds = new Set(selections[group.id] ?? []);
      const groupSum = group.options.filter((o) => selectedIds.has(o.id)).reduce((s, o) => s + Number(o.priceDelta), 0);
      return sum + groupSum;
    }, 0);
    return Number(product.price) + deltaSum;
  }, [optionGroups, selections, product.price]);

  function selectSingle(groupId: string, optionId: string) {
    setSelections((prev) => ({ ...prev, [groupId]: [optionId] }));
  }

  function toggleMultiple(group: ConfiguratorOptionGroup, optionId: string) {
    setSelections((prev) => {
      const current = prev[group.id] ?? [];
      const isSelected = current.includes(optionId);
      if (isSelected) return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      if (group.maxSelections !== null && current.length >= group.maxSelections) return prev;
      return { ...prev, [group.id]: [...current, optionId] };
    });
  }

  function handleAddToBasket() {
    if (unsatisfiedGroups.length > 0) {
      setAttemptedSubmit(true);
      return;
    }
    const optionIds = optionGroups.flatMap((g) => selections[g.id] ?? []);
    cart.addConfiguredLine(product.id, optionIds, quantity);
    router.push(`${basePath}/basket`);
  }

  return (
    <div className={styles.wrap}>
      {product.imageUrl && (
        // Business-supplied photo, not a bundled asset — plain img.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.imageUrl} alt={product.name} className={styles.image} />
      )}
      {product.description && <p className={styles.description}>{product.description}</p>}

      {optionGroups.map((group) => {
        const selected = selections[group.id] ?? [];
        const unsatisfied = attemptedSubmit && group.minSelections > 0 && selected.length < group.minSelections;
        return (
          <fieldset key={group.id} className={styles.group}>
            <legend className={styles.groupLegend}>
              {group.name}
              <span className={styles.groupHint}>
                {group.minSelections > 0 ? " · Required" : " · Optional"}
                {group.selectionType === "MULTIPLE" && group.maxSelections ? ` · Choose up to ${group.maxSelections}` : ""}
              </span>
            </legend>
            {unsatisfied && (
              <p className={styles.groupError} role="alert">
                Choose {group.minSelections === 1 ? "an option" : `at least ${group.minSelections}`} for {group.name}.
              </p>
            )}
            <div className={styles.optionList}>
              {group.options.map((option) => {
                const checked = selected.includes(option.id);
                const atMax =
                  group.selectionType === "MULTIPLE" && group.maxSelections !== null && selected.length >= group.maxSelections && !checked;
                return (
                  <label key={option.id} className={styles.optionRow} data-disabled={atMax}>
                    <input
                      type={group.selectionType === "SINGLE" ? "radio" : "checkbox"}
                      name={`group-${group.id}`}
                      checked={checked}
                      disabled={atMax}
                      onChange={() =>
                        group.selectionType === "SINGLE" ? selectSingle(group.id, option.id) : toggleMultiple(group, option.id)
                      }
                      className={styles.optionInput}
                    />
                    <span className={styles.optionName}>{option.name}</span>
                    <span className={styles.optionPrice}>
                      {Number(option.priceDelta) > 0 ? `+${formatZAR(option.priceDelta)}` : "+R0.00"}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <div className={styles.quantityRow}>
        <span className={styles.quantityLabel}>Quantity</span>
        <div className={styles.quantityStepper}>
          <button
            type="button"
            className={styles.quantityButton}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            aria-label="Decrease quantity"
          >
            −
          </button>
          <span className={styles.quantityValue}>{quantity}</span>
          <button
            type="button"
            className={styles.quantityButton}
            onClick={() => setQuantity((q) => Math.min(99, q + 1))}
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
      </div>

      <div className={styles.footer}>
        <div className={styles.total} aria-live="polite">
          <span>Total</span>
          <span className={styles.totalValue}>{formatZAR(configuredUnitPrice * quantity)}</span>
        </div>
        <button type="button" className={`btn ${viewStyles.storeActionPrimary}`} onClick={handleAddToBasket}>
          Add to basket
        </button>
      </div>
    </div>
  );
}
