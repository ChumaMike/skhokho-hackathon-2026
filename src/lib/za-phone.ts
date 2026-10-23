// Vendored from the sg-os monorepo's @sgdataint/utils (packages/utils/src/phone.ts)
// so this snapshot installs on its own. Behaviour is identical.
/**
 * South African mobile number helpers.
 *
 * Previously duplicated independently in both `skhokho-platform` and
 * `skhokho-labs` (each business-unit's own graduation record flagged this as
 * an open gap). This is the shared canonical version; `skhokho-platform`
 * consumes it directly. `skhokho-labs` is left untouched since its canonical
 * source is a separate, unsynced repo.
 */

export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("27") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10)
    return `+27${digits.slice(1)}`;
  if (digits.length === 9) return `+27${digits}`;
  return `+${digits}`;
}

export function isValidZaMobile(e164: string): boolean {
  return /^\+27[678]\d{8}$/.test(e164);
}
