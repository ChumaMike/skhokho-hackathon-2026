/**
 * The About section's heading: the business's own short tagline
 * (Business.description) when it also has a longer story to show beneath it
 * (StorefrontContent.about.body) — otherwise a neutral label. Never advice
 * addressed to the merchant, and never the same words twice.
 */
export const ABOUT_FALLBACK_HEADING = 'Our story'
const MAX_TAGLINE_HEADING = 90

export function aboutHeading(body: string | null | undefined, description: string | null | undefined): string {
  const story = body?.trim()
  const tagline = description?.trim()
  if (story && tagline && tagline !== story && tagline.length <= MAX_TAGLINE_HEADING) return tagline
  return ABOUT_FALLBACK_HEADING
}
