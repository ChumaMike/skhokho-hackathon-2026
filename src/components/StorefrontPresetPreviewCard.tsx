"use client";

import type { CSSProperties } from "react";
import type { StorefrontPresetId } from "@/modules/tenant/storefront-theme";
import { resolveStorefrontTokens, DEFAULT_STOREFRONT_THEME } from "@/modules/tenant/storefront-theme";
import { STOREFRONT_PRESET_LABELS } from "@/modules/tenant/storefront-presets";
import styles from "./StorefrontPresetPreviewCard.module.css";

/**
 * A small mock — real business name + a fake product row + a fake button —
 * driven by the SAME resolveStorefrontTokens/STYLE_PRESETS data every real
 * StorefrontView render uses, so it can never lie about what a preset
 * produces. Deliberately NOT a full StorefrontView mount (six of those with
 * real catalog data would be needlessly heavy for "which feels closest to
 * your business?") — the spec itself distinguishes this miniature step from
 * the Review step's actual real-component preview.
 */
export default function StorefrontPresetPreviewCard({
  presetId,
  businessName,
  primaryColor,
  accentColor,
  selected,
  onSelect,
}: {
  presetId: StorefrontPresetId;
  businessName: string;
  primaryColor?: string | null;
  accentColor?: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const tokens = resolveStorefrontTokens(
    { primaryColor, accentColor },
    { version: 1, profile: {}, theme: { ...DEFAULT_STOREFRONT_THEME, presetId } },
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`${styles.card} ${selected ? styles.cardSelected : ""}`}
      style={tokens as CSSProperties}
      aria-pressed={selected}
    >
      <div className={styles.mockHeader}>
        <div className={styles.mockLogo}>{businessName.charAt(0).toUpperCase()}</div>
        <span className={styles.mockName}>{businessName}</span>
      </div>
      <div className={styles.mockItem}>
        <span className={styles.mockItemName}>Your product</span>
        <span className={styles.mockItemPrice}>R 45.00</span>
      </div>
      <div className={styles.mockButton}>Order</div>
      <span className={styles.label}>{STOREFRONT_PRESET_LABELS[presetId]}</span>
    </button>
  );
}
