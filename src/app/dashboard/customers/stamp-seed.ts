/**
 * Deterministic "rubber stamp" transform for a filled loyalty disc.
 *
 * DESIGN.md: filled slots get "a small random rotation (-8° to +8°) and 1–2px
 * offset — a real rubber stamp never lands square. The seed is the
 * membership id, so a given card looks identical on every render." No
 * `Math.random()` at render time — this is a pure function of
 * (membershipPublicId, slotIndex).
 *
 * `customer.service` never returns the raw `memberships.id` to the UI (POPIA:
 * businesses only ever see the pairwise `public_id`), so `public_id` is used
 * as the seed instead — it's unique per membership, which is all the
 * determinism actually requires.
 */

export interface StampTransform {
  /** degrees, -8..8 */
  rotate: number;
  /** px, -2..2 */
  x: number;
  /** px, -2..2 */
  y: number;
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function stampTransform(
  membershipPublicId: string,
  slotIndex: number,
): StampTransform {
  const h = hash(`${membershipPublicId}:${slotIndex}`);
  const rotate = ((h % 1601) / 100) - 8;
  const x = (((h >>> 8) % 401) / 100) - 2;
  const y = (((h >>> 16) % 401) / 100) - 2;
  return { rotate, x, y };
}
