import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// ---------------------------------------------------------------------------
// Class names (shadcn/ui convention — components import `cn` from
// `@/lib/utils`, so it lives here alongside the app's other utilities rather
// than in a separate file)
// ---------------------------------------------------------------------------

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ---------------------------------------------------------------------------
// Trusted origin
// ---------------------------------------------------------------------------

/**
 * The canonical app origin, e.g. "https://skhokho-platform.vercel.app" — NOT
 * derived from the incoming request's Host header. `new URL(path, req.url)`
 * (used for same-request-cycle redirects elsewhere in this app) reflects
 * whatever Host the client sent; on most platforms that's fine for
 * redirecting a browser back to a path on the domain it's already talking
 * to, but it must never be trusted for a URL that leaves this request —
 * embedded in an email, or handed to a third-party webhook config (PayFast's
 * notify_url) — because a spoofed Host would then point a real user's
 * password-reset link, or a payment gateway's server-to-server callback, at
 * an attacker-controlled domain instead. Falls back to the request's own
 * origin only when NEXT_PUBLIC_APP_URL isn't configured (e.g. local dev),
 * with a logged warning — this fallback is what a security review would
 * still flag as unfinished, not what it should ship as.
 */
export function getAppUrl(requestOrigin?: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, "")

  // Never in production: a reset/invite link or webhook URL built from a
  // request's Host header can be pointed at an attacker's domain.
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("NEXT_PUBLIC_APP_URL must be set in production.")
  }

  console.warn(
    "[getAppUrl] NEXT_PUBLIC_APP_URL is not set — falling back to the request's own Host header. " +
      "Fine for local dev; set this before anything that emails a link or configures a webhook goes live.",
  )
  return (requestOrigin ?? "http://localhost:3000").replace(/\/$/, "")
}

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

/**
 * Guard against open redirects from a client-supplied "return to" path (e.g.
 * a hidden form field). Only a single-slash-relative, same-origin path is
 * accepted — rejects absolute URLs, protocol-relative `//host` (browsers
 * treat this as same-scheme-different-host), and the `/\host` backslash
 * variant some browsers still normalise to `//`. Anything else falls back
 * to `fallback`.
 */
export function safeReturnPath(input: string, fallback = "/"): string {
  if (input.startsWith("/") && !input.startsWith("//") && !input.startsWith("/\\")) {
    return input
  }
  return fallback
}

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

/**
 * Turn a business name into a URL-safe subdomain slug.
 * `Beauty by Nomsa!` → `beauty-by-nomsa`
 *
 * Strips accents so "Café Süd" → "cafe-sud" rather than dropping characters.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// ---------------------------------------------------------------------------
// Order numbers
// ---------------------------------------------------------------------------

const ORDER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no I/O/0/1

/**
 * Human-readable order reference, e.g. `ORD-5K2M-7X9Q`.
 * Random rather than sequential so one business can't infer another's volume.
 */
export function generateOrderNumber(prefix = "ORD"): string {
  const block = (n: number) =>
    Array.from({ length: n }, () =>
      ORDER_ALPHABET[Math.floor(Math.random() * ORDER_ALPHABET.length)],
    ).join("")

  return `${prefix}-${block(4)}-${block(4)}`
}

// ---------------------------------------------------------------------------
// South African formatting
// ---------------------------------------------------------------------------

/**
 * Format an amount as ZAR in house style: `R 1 234.56` (space thousands
 * separator, per South African convention).
 *
 * Accepts a number, a numeric string, or a Prisma `Decimal`.
 */
export function formatZAR(amount: number | string | { toString(): string }): string {
  const value = typeof amount === "number" ? amount : Number(amount.toString())
  if (!Number.isFinite(value)) return "R 0.00"

  const [whole, fraction] = Math.abs(value).toFixed(2).split(".")
  const spaced = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")

  return `${value < 0 ? "-" : ""}R ${spaced}.${fraction}`
}

/** `R 1 234.56` from an integer cents value. */
export function formatCents(cents: number): string {
  return formatZAR(cents / 100)
}

/**
 * Normalise a South African mobile number to E.164: `+27821234567`.
 * Accepts `082 123 4567`, `0821234567`, `27821234567`, `+27 82 123 4567`.
 * Returns null if it isn't a plausible SA number.
 */
export function normalizeSAPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "").replace(/^\+/, "")

  if (/^0\d{9}$/.test(digits)) return `+27${digits.slice(1)}`
  if (/^27\d{9}$/.test(digits)) return `+${digits}`
  if (/^0027\d{9}$/.test(digits)) return `+${digits.slice(2)}`
  return null
}

/**
 * The one way to build a WhatsApp link: `https://wa.me/27821234567`, from a
 * South African number in any common format (`082 123 4567`, `0821234567`,
 * `27…`, `+27 …`, `0027…`). wa.me needs the international form — a local
 * `0…` number makes a link that silently goes nowhere — so an unparseable
 * number gives null (no button), never a broken link.
 */
export function whatsappLink(raw: string | null | undefined, message?: string): string | null {
  if (!raw) return null
  const e164 = normalizeSAPhone(raw)
  if (!e164) return null
  return `https://wa.me/${e164.slice(1)}${message ? `?text=${encodeURIComponent(message)}` : ""}`
}

/** Display form: `+27 82 123 4567`. Returns the input unchanged if unparseable. */
export function formatSAPhone(input: string): string {
  const e164 = normalizeSAPhone(input)
  if (!e164) return input
  const n = e164.slice(3) // drop +27
  return `+27 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/** Success envelope for route handlers. */
export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ ok: true, data }, { status: 200, ...init })
}

/** Error envelope for route handlers. */
export function fail(error: string, status = 400, details?: unknown): Response {
  return Response.json({ ok: false, error, details }, { status })
}

/**
 * Map a thrown error to an HTTP response.
 * Recognises AuthError (401/403), Zod errors (422) and stock conflicts (409);
 * everything else becomes a 500 whose detail is logged but not sent to the
 * client.
 */
export function handleApiError(error: unknown): Response {
  // AuthError carries its own status — matched structurally rather than by
  // import, to avoid a cycle between this module and @/lib/auth/guards.
  if (
    error instanceof Error &&
    error.name === "AuthError" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return fail(error.message, (error as { status: number }).status)
  }

  if (error instanceof Error && error.name === "ZodError") {
    return fail("Validation failed", 422, (error as unknown as { issues: unknown }).issues)
  }

  if (error instanceof Error && error.name === "InsufficientStockError") {
    return fail(error.message, 409)
  }

  // Tab 4: a plan limit refusal. Matched structurally for the same reason as
  // AuthError above — modules/billing/limits.ts must not import from
  // lib/auth/guards, which would drag `next/headers` into every caller. The
  // message is written for a shop owner and is safe to return as-is.
  if (error instanceof Error && error.name === "PlanLimitError") {
    return fail(error.message, 403)
  }

  console.error("[api] unhandled error:", error)
  return fail("Something went wrong on our side. Please try again.", 500)
}

// ---------------------------------------------------------------------------
// Form parsing
// ---------------------------------------------------------------------------

/**
 * Trims a FormData value and turns an empty/missing string into `undefined`
 * (so an optional Zod field is genuinely omitted, not overwritten with "").
 * Deliberately NOT in a "use server" actions file — every export from one of
 * those is treated as a Server Action, which must be async; this is a plain
 * sync helper several actions files (settings, storefront/business-
 * information, storefront/ordering) share.
 */
export function trimmedOrUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = (value ?? "").toString().trim()
  return s || undefined
}
