/**
 * The one definition of "safe text" for everything a storefront spec may
 * carry. Split out of spec.ts so the page model (pages.ts) can use it
 * without a circular import.
 */

import { z } from 'zod'

/** Anything that could open a tag, an attribute or a template is refused, not escaped. */
export const UNSAFE_TEXT = /[<>{}]|javascript:|https?:\/\//i

/** Safe, bounded, single-line-ish text — the only kind of words a spec may carry. */
export function specText(max: number) {
  return z
    .string()
    .trim()
    .min(1, 'must not be empty')
    .max(max, `must be ${max} characters or fewer`)
    .refine((value) => !UNSAFE_TEXT.test(value), 'must not contain markup, braces or links')
}
