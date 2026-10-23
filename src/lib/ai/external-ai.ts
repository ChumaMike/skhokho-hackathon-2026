/**
 * The ONE switch for sending any business data to an external model.
 *
 * Every AI feature (owner buddy, storefront copy, onboarding brief, design
 * wizard content, template pages, the signup category classifier) has a
 * built-in rules fallback and must choose the external model only through
 * this function. Having a key on the server is not consent: the external
 * path stays off until BUDDY_EXTERNAL_AI=enabled is set deliberately, after
 * the cross-border / POPIA boundary is signed off (docs/legal-dependencies.md).
 */
export function externalAiEnabled(): boolean {
  return process.env.BUDDY_EXTERNAL_AI === 'enabled' && Boolean(process.env.ANTHROPIC_API_KEY)
}
