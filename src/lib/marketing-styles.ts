import type React from "react";

/**
 * Shared inline-style tokens for the richer marketing sections added below
 * the existing hero/problem/how-it-works narrative (see page.tsx). Ported
 * from skhokho-labs' equivalent `lib/styles.ts` structure, retuned to this
 * app's own type stack (Archivo Black, not Bebas Neue) and card radius.
 */
export const S = {
  secLabel: {
    display: "inline-flex" as const,
    alignItems: "center" as const,
    gap: "6px",
    fontSize: ".7rem",
    fontWeight: 700,
    letterSpacing: ".16em",
    textTransform: "uppercase" as const,
    color: "var(--amber)",
    marginBottom: "10px",
  } as React.CSSProperties,
  secTitle: {
    fontFamily: "var(--font-display)",
    fontWeight: 400,
    // Matches skhokho-labs' actual measured scale for this shared title
    // style (clamp(2rem,9vw,4rem) — verified against the live site's
    // computed styles, not eyeballed). An earlier pass here used
    // clamp(1.8rem,6vw,2.8rem), well under half the real max size — that
    // shrinkage, repeated across every ported section, is why the page
    // read as "recolored" rather than actually agency-scale.
    fontSize: "clamp(2rem,9vw,4rem)",
    letterSpacing: 0,
    lineHeight: 0.95,
    marginBottom: "12px",
    color: "var(--chalk)",
  } as React.CSSProperties,
  secDesc: {
    fontSize: ".9rem",
    color: "var(--dust)",
    lineHeight: 1.7,
    maxWidth: "560px",
    marginBottom: "28px",
  } as React.CSSProperties,
  card: {
    background: "var(--board)",
    border: "1px solid var(--edge)",
    borderRadius: "var(--radius-card)",
    padding: "20px",
    position: "relative" as const,
    overflow: "hidden" as const,
  } as React.CSSProperties,
};
