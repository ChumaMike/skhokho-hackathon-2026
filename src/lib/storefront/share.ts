/**
 * Sharing a product — the text and address a customer sends to WhatsApp,
 * Instagram, TikTok or Facebook with one tap (Tab 7, social products
 * phase 1: docs/plans/2026-10-23-social-products.md).
 *
 * Pure: used by the client ShareButton, the server-rendered product page
 * and the catalogue editor alike, so what a merchant types as hashtags,
 * what the page shows and what the share says are always the same rule.
 * No Prisma, no window.
 */

import { formatZAR } from '@/lib/utils'

/** A merchant may put up to eight hashtags on a product. */
export const MAX_HASHTAGS = 8
/** Instagram allows far longer, but a tag a customer can read on a phone stops here. */
export const MAX_HASHTAG_LENGTH = 30

/**
 * One hashtag as stored: no leading '#', no spaces or punctuation, lower
 * case, letters (any script), digits and underscores only, and it must
 * start with a letter or digit. "#Kota Special!" → "kotaspecial".
 * Null when nothing usable is left.
 */
export function normaliseHashtag(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}_]/gu, '')
    .toLowerCase()
    .slice(0, MAX_HASHTAG_LENGTH)
  if (!cleaned || !/^[\p{L}\p{N}]/u.test(cleaned)) return null
  return cleaned
}

/**
 * What the merchant typed — "#kota, #soweto braai" or a list — as the
 * stored tags: normalised, de-duplicated, in the order given, capped at
 * MAX_HASHTAGS. Splits on whitespace, commas and '#' so every habit works.
 */
export function parseHashtags(input: string | readonly string[]): string[] {
  const parts = typeof input === 'string' ? input.split(/[\s,#]+/) : input.flatMap((s) => s.split(/[\s,#]+/))
  const out: string[] = []
  for (const part of parts) {
    const tag = normaliseHashtag(part)
    if (tag && !out.includes(tag)) out.push(tag)
    if (out.length === MAX_HASHTAGS) break
  }
  return out
}

/** "#kota #soweto" — the line as it appears in a share and on the page. */
export function hashtagLine(tags: readonly string[]): string {
  return tags.map((t) => `#${t}`).join(' ')
}

/** The product page, relative to the storefront root. */
export function productSharePath(productId: string): string {
  return `/product/${productId}`
}

/** The tag page, relative to the storefront root. */
export function tagPagePath(tag: string): string {
  return `/tag/${encodeURIComponent(tag)}`
}

/**
 * A short token that changes when anything on the share card changes
 * (name, price, photo, shop name or logo), so a cached card is replaced
 * the moment the merchant edits. FNV-1a over the inputs: stable, tiny,
 * and fine in the browser — this is a cache key, not a secret.
 */
export function shareImageVersion(input: { name: string; price: string | number; imageUrl?: string | null; businessName: string; logoUrl?: string | null }): string {
  const text = [input.name, String(input.price), input.imageUrl ?? '', input.businessName, input.logoUrl ?? ''].join('\u0000')
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** The composed share card's size — the Open Graph standard 1200×630 (route: product/[productId]/share-image). */
export const SHARE_IMAGE_WIDTH = 1200
export const SHARE_IMAGE_HEIGHT = 630

/** The composed share card for a product, relative to the storefront root (route: product/[productId]/share-image). */
export function shareImagePath(productId: string, version: string): string {
  return `/product/${productId}/share-image?v=${encodeURIComponent(version)}`
}

/** Every distinct hashtag across these products, in first-seen order — the sitemap's tag pages. */
export function uniqueHashtags(products: readonly { hashtags?: readonly string[] }[]): string[] {
  const out: string[] = []
  for (const p of products) for (const tag of p.hashtags ?? []) if (!out.includes(tag)) out.push(tag)
  return out
}

/**
 * The products carrying a tag, matched by the stored rule so '#Kota', 'kota'
 * and 'KOTA' are one page. Null when the tag is unusable or nothing has it:
 * the page is then a 404, never an empty list.
 */
export function productsWithTag<P extends { hashtags?: readonly string[] }>(products: readonly P[], raw: string): { tag: string; products: P[] } | null {
  const tag = normaliseHashtag(raw)
  if (!tag) return null
  const matched = products.filter((p) => p.hashtags?.includes(tag))
  return matched.length > 0 ? { tag, products: matched } : null
}

export interface ShareInput {
  name: string
  /** Decimal string or number, as the catalogue serialises it. */
  price: string | number
  businessName: string
  hashtags?: readonly string[]
  /** Absolute, canonical product URL. */
  url: string
}

export interface ShareMessage {
  /** Web Share API title (some targets show it, most ignore it). */
  title: string
  /** The message body WITHOUT the link — targets that take `url` separately append it themselves. */
  text: string
  url: string
  /** Body and link together, for the clipboard and for targets without a `url` field. */
  full: string
}

/**
 * What gets shared, in the plan's order: product name, price as
 * `R 1 234.56`, shop name, then hashtags on their own line, then the link.
 * The merchant's name and the product name are shown as typed — a share is
 * their own words, not ours.
 */
export function buildShareMessage(input: ShareInput): ShareMessage {
  const name = input.name.trim()
  const shop = input.businessName.trim()
  const lines = [`${name} · ${formatZAR(input.price)} · ${shop}`]
  const tags = input.hashtags && input.hashtags.length > 0 ? hashtagLine(input.hashtags) : ''
  if (tags) lines.push(tags)
  const text = lines.join('\n')
  return { title: `${name} · ${shop}`, text, url: input.url, full: `${text}\n${input.url}` }
}
