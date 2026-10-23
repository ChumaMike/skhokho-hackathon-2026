/**
 * Honeypot: a form field real people never see or fill (rendered by
 * components/HoneypotField). Bots that fill every field reveal themselves.
 * Name kept innocuous so form-fillers don't skip it. Dependency-free so the
 * field can render in client components.
 */
export const HONEYPOT_FIELD = 'website'

export function honeypotTripped(value: FormDataEntryValue | string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}
