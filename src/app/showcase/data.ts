/**
 * Showcase catalogue.
 *
 * Platform plans come from the database (plans + plan_entitlements, read by
 * page.tsx via listPublicPlans) and are shaped here by toShowcasePlan — the
 * same rows the entitlement system enforces, so the page can never advertise
 * something a plan doesn't actually include. A plan without a price shows
 * "Pricing coming soon": prices are a commercial decision kept in data.
 *
 * Add-on services below are static and DO carry known studio prices.
 */

import { FEATURE_KEYS, FEATURES, isFeatureKey, type FeatureKey } from "@/modules/billing/features";
import { formatZAR } from "@/lib/utils";

/**
 * A plan as the showcase shows it — built from the database plans
 * (listPublicPlans), so what's advertised is exactly what entitlements
 * enforce. No plan names or prices live in this file.
 */
export interface ShowcasePlan {
  code: string;
  name: string;
  tagline: string | null;
  priceLabel: string;
  limits: { label: string; value: string }[];
  features: { key: FeatureKey; label: string; included: boolean }[];
}

type PlanRow = {
  code: string;
  name: string;
  tagline: string | null;
  priceCents: number | null;
  interval: "MONTHLY" | "YEARLY" | null;
  entitlements: { featureKey: string; enabled: boolean; limitValue: number | null }[];
};

function priceLabel(priceCents: number | null, interval: PlanRow["interval"]): string {
  if (priceCents === null) return "Pricing coming soon";
  if (priceCents === 0) return "Free";
  const per = interval === "YEARLY" ? " / year" : interval === "MONTHLY" ? " / month" : "";
  return `${formatZAR(priceCents / 100)}${per}`;
}

export function toShowcasePlan(plan: PlanRow): ShowcasePlan {
  const granted = new Map<FeatureKey, number | null>();
  for (const row of plan.entitlements) {
    if (row.enabled && isFeatureKey(row.featureKey)) granted.set(row.featureKey, row.limitValue);
  }
  return {
    code: plan.code,
    name: plan.name,
    tagline: plan.tagline,
    priceLabel: priceLabel(plan.priceCents, plan.interval),
    limits: FEATURE_KEYS.filter((key) => FEATURES[key].kind === "limit" && granted.has(key)).map((key) => {
      const limit = granted.get(key);
      return { label: FEATURES[key].label, value: limit === null || limit === undefined ? "Unlimited" : String(limit) };
    }),
    features: FEATURE_KEYS.filter((key) => FEATURES[key].kind === "boolean").map((key) => ({
      key,
      label: FEATURES[key].label,
      included: granted.has(key),
    })),
  };
}

// ---------------------------------------------------------------------------
// Add-on services — hand-built by the studio. Prices from CLAUDE.md (the
// single source of truth for these five products).
// ---------------------------------------------------------------------------

export interface ServiceInfo {
  slug: "website" | "whatsapp-ordering" | "voice-agent" | "content" | "speed-to-lead";
  name: string;
  blurb: string;
  setup: number;
  setupFrom: boolean;
  monthly: number;
  monthlyFrom: boolean;
}

export const SERVICES: ServiceInfo[] = [
  {
    slug: "website",
    name: "Website",
    blurb: "A site for your business, built and hosted for you.",
    setup: 1500,
    setupFrom: true,
    monthly: 300,
    monthlyFrom: true,
  },
  {
    slug: "whatsapp-ordering",
    name: "WhatsApp ordering",
    blurb: "Customers order straight from a WhatsApp chat — no app needed.",
    setup: 3000,
    setupFrom: false,
    monthly: 1000,
    monthlyFrom: false,
  },
  {
    slug: "voice-agent",
    name: "AI voice agent",
    blurb: "Answers your phone and books the job while your hands are full.",
    setup: 2500,
    setupFrom: true,
    monthly: 1500,
    monthlyFrom: true,
  },
  {
    slug: "content",
    name: "Content dashboard",
    blurb: "Social posts written and scheduled for your business every week.",
    setup: 5000,
    setupFrom: false,
    monthly: 1500,
    monthlyFrom: false,
  },
  {
    slug: "speed-to-lead",
    name: "Speed to lead",
    blurb: "New enquiries get an instant reply, before they call someone else.",
    setup: 4500,
    setupFrom: false,
    monthly: 1000,
    monthlyFrom: true,
  },
];

/** House style: `R 1 500` — space thousands separator, no decimals. */
export function formatRand(amount: number): string {
  return `R ${amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
}
