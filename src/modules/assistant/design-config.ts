import { parseHexColor } from "@/lib/storefront-colors";

/**
 * The only shape an AI design suggestion may take. The model never writes
 * HTML or CSS: it picks from these fields, and our components render them.
 * Anything not on this list (unknown keys, markup in copy, odd colours,
 * sections we don't render) is rejected, not silently dropped.
 */
export const DESIGN_TEMPLATES = ["PRODUCT", "BOOKING"] as const;
export type DesignTemplate = (typeof DESIGN_TEMPLATES)[number];

export const DESIGN_SECTIONS = ["hero", "products", "services", "about", "contact"] as const;
export type DesignSection = (typeof DESIGN_SECTIONS)[number];

export const HEADLINE_MAX = 80;
export const SUBLINE_MAX = 160;

export interface DesignConfig {
  templateId: DesignTemplate;
  primaryColor?: string;
  accentColor?: string;
  sectionOrder?: DesignSection[];
  heroHeadline?: string;
  heroSubline?: string;
}

export type DesignConfigResult = { ok: true; config: DesignConfig } | { ok: false; errors: string[] };

const ALLOWED_KEYS = new Set([
  "templateId",
  "primaryColor",
  "accentColor",
  "sectionOrder",
  "heroHeadline",
  "heroSubline",
]);

/** Anything that could open a tag or an attribute is refused, not escaped. */
function hasMarkup(text: string): boolean {
  return /[<>]/.test(text);
}

export function validateDesignConfig(raw: unknown): DesignConfigResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["Design must be an object."] };
  }
  const input = raw as Record<string, unknown>;

  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) errors.push(`Unknown field "${key}".`);
  }

  const templateId = input.templateId;
  if (!DESIGN_TEMPLATES.includes(templateId as DesignTemplate)) {
    errors.push(`templateId must be one of ${DESIGN_TEMPLATES.join(", ")}.`);
  }

  for (const key of ["primaryColor", "accentColor"] as const) {
    if (input[key] !== undefined && parseHexColor(input[key] as string) === null) {
      errors.push(`${key} must be a hex colour like #9A5A0A.`);
    }
  }

  let sectionOrder: DesignSection[] | undefined;
  if (input.sectionOrder !== undefined) {
    const list = input.sectionOrder;
    if (!Array.isArray(list) || list.some((s) => !DESIGN_SECTIONS.includes(s as DesignSection))) {
      errors.push(`sectionOrder may only contain ${DESIGN_SECTIONS.join(", ")}.`);
    } else if (new Set(list).size !== list.length) {
      errors.push("sectionOrder must not repeat a section.");
    } else {
      sectionOrder = list as DesignSection[];
    }
  }

  const copy: Array<["heroHeadline" | "heroSubline", number]> = [
    ["heroHeadline", HEADLINE_MAX],
    ["heroSubline", SUBLINE_MAX],
  ];
  for (const [key, max] of copy) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`${key} must be non-empty text.`);
    } else if (value.length > max) {
      errors.push(`${key} must be ${max} characters or fewer.`);
    } else if (hasMarkup(value)) {
      errors.push(`${key} cannot contain < or >.`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const config: DesignConfig = { templateId: templateId as DesignTemplate };
  if (input.primaryColor !== undefined) config.primaryColor = input.primaryColor as string;
  if (input.accentColor !== undefined) config.accentColor = input.accentColor as string;
  if (sectionOrder) config.sectionOrder = sectionOrder;
  if (input.heroHeadline !== undefined) config.heroHeadline = (input.heroHeadline as string).trim();
  if (input.heroSubline !== undefined) config.heroSubline = (input.heroSubline as string).trim();
  return { ok: true, config };
}
