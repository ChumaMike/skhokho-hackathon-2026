/**
 * Production configuration, classified. The ONE place that says which
 * environment variables the app needs, for what, and what happens without
 * them. `validateEnvironment()` runs at server start (src/instrumentation.ts).
 *
 * Policy: a variable the app cannot run safely without fails startup in
 * production — never replaced with an insecure default. A variable that
 * powers one feature only is reported, and that feature fails closed on its
 * own (each module already refuses to run unconfigured).
 */

export type EnvClass = 'startup' | 'payments' | 'paid-plans' | 'domains' | 'ai' | 'email' | 'delivery' | 'messaging' | 'push' | 'optional'

export interface EnvVar {
  name: string
  class: EnvClass
  /** What happens when it's missing. */
  whenMissing: string
  /** Extra check on the value, returning a problem or null. */
  check?: (value: string) => string | null
}

export const ENV_VARS: EnvVar[] = [
  // --- required to start ------------------------------------------------------------
  { name: 'POSTGRES_PRISMA_URL', class: 'startup', whenMissing: 'No database — the app cannot serve anything.' },
  { name: 'POSTGRES_URL_NON_POOLING', class: 'startup', whenMissing: 'Migrations (prisma migrate deploy) cannot run.' },
  {
    name: 'JWT_SECRET',
    class: 'startup',
    whenMissing: 'No sessions can be signed or verified; every sign-in fails.',
    check: (v) => (v.length < 32 ? 'must be at least 32 characters' : null),
  },
  {
    name: 'NEXT_PUBLIC_APP_URL',
    class: 'startup',
    whenMissing: 'Password-reset, invite and PayFast notify URLs would come from request headers — refused in production.',
    check: (v) => (/^https:\/\//.test(v) ? null : 'must be an https:// URL in production'),
  },
  // --- features: each fails closed on its own --------------------------------------
  { name: 'PAYMENT_ENCRYPTION_KEY', class: 'payments', whenMissing: 'Merchants cannot save PayFast credentials (saving fails loudly).' },
  { name: 'PAYMENTS_ALLOW_LIVE_VERIFICATION', class: 'payments', whenMissing: 'Live PayFast verification stays off, so no merchant can take card payments.' },
  // Tab 5
  { name: 'PAYFAST_ITN_SOURCE_CHECK', class: 'optional', whenMissing: 'Payment notifications are accepted only from PayFast hosts in production (on by default there; off elsewhere). Set off/on to override.' },
  { name: 'CRON_SECRET', class: 'startup', whenMissing: 'The daily job refuses to run: no payment reconciliation, domain re-checks or data retention.' },
  { name: 'PAYFAST_MERCHANT_ID', class: 'paid-plans', whenMissing: 'Platform (merchant → Skhokho) billing is unconfigured — paid plans must stay disabled.' },
  { name: 'PAYFAST_MERCHANT_KEY', class: 'paid-plans', whenMissing: 'As above.' },
  { name: 'PAYFAST_PASSPHRASE', class: 'paid-plans', whenMissing: 'As above.' },
  { name: 'VERCEL_DOMAINS_TOKEN', class: 'domains', whenMissing: 'Custom domains can be added but never go live (hosting provider unconfigured).' },
  { name: 'VERCEL_PROJECT_ID', class: 'domains', whenMissing: 'As above.' },
  { name: 'DOMAIN_REGISTRAR', class: 'domains', whenMissing: 'Domain purchase is not offered (no registrar). Sandbox is refused in production.' },
  { name: 'STOREFRONT_DOMAIN', class: 'domains', whenMissing: 'Storefronts stay on /store/<slug> (no <slug>.<domain> subdomains).' },
  { name: 'ANTHROPIC_API_KEY', class: 'ai', whenMissing: 'AI features use built-in rules (storefront drafts from business details; buddy rules-only).' },
  { name: 'BUDDY_EXTERNAL_AI', class: 'ai', whenMissing: 'Business Buddy never sends anything to an external AI provider (default, until the legal boundary is approved).' },
  { name: 'RESEND_API_KEY', class: 'email', whenMissing: 'No emails: password reset shows "unavailable", invites must be shared by hand.' },
  { name: 'EMAIL_FROM', class: 'email', whenMissing: 'As above.' },
  // --- Skhokholetha (each switch is OFF unless exactly "true") -----------------------
  { name: 'SKHOKHOLETHA_ENABLED', class: 'delivery', whenMissing: 'Skhokholetha is off: no going online, no offers, no new requests. Deliveries already running can finish.' },
  { name: 'DRIVER_SIGNUP_ENABLED', class: 'delivery', whenMissing: 'No new driver accounts or application submissions.' },
  { name: 'DELIVERY_REQUESTS_ENABLED', class: 'delivery', whenMissing: 'Shops cannot request a Skhokholetha driver.' },
  { name: 'DRIVER_APPROVALS_ENABLED', class: 'delivery', whenMissing: 'Admins cannot approve or reinstate drivers.' },
  { name: 'DRIVER_TERMS_VERSION', class: 'delivery', whenMissing: 'No driver can accept terms, submit an application or be approved (legal gate).' },
  { name: 'DRIVER_TERMS_URL', class: 'delivery', whenMissing: 'As above (must be https).' },
  { name: 'DRIVER_PRIVACY_VERSION', class: 'delivery', whenMissing: 'As above.' },
  { name: 'DRIVER_PRIVACY_URL', class: 'delivery', whenMissing: 'As above (must be https).' },
  // --- Customer phone messaging (src/lib/messaging/provider.ts) ----------------------
  // One entry for the provider switch, reconciling notify-sms (bulksms) and
  // notify-whatsapp (whatsapp): the allowed values are the cases provider.ts
  // knows, console is refused in production because it prints sign-in codes
  // to the log, and anything else is reported with the allowed list.
  {
    name: 'MESSAGE_PROVIDER',
    class: 'messaging',
    whenMissing: 'No phone messages: sign-in codes go by email only and order updates reach phones not at all (logged and audited).',
    check: (v) => {
      const value = v.trim().toLowerCase()
      if (value === 'console') return isProductionDeployment() ? 'console prints sign-in codes to the log — refused in production' : null
      return MESSAGE_PROVIDERS.includes(value) ? null : `is "${v}" — expected one of ${MESSAGE_PROVIDERS.map((p) => `"${p}"`).join(', ')} (console is dev only)`
    },
  },
  { name: 'WHATSAPP_PHONE_NUMBER_ID', class: 'messaging', whenMissing: 'MESSAGE_PROVIDER=whatsapp has no sending number — behaves as unconfigured (see MESSAGE_PROVIDER).' },
  { name: 'WHATSAPP_ACCESS_TOKEN', class: 'messaging', whenMissing: 'As above.' },
  { name: 'WHATSAPP_VERIFY_TOKEN', class: 'messaging', whenMissing: 'Meta cannot verify the webhook URL: no delivery statuses, and STOP replies never reach us.' },
  { name: 'WHATSAPP_APP_SECRET', class: 'messaging', whenMissing: 'Webhook signatures cannot be checked, so the webhook refuses every call (and the provider is unconfigured).' },
  // --- Web Push (Tab 7: order updates on the customer's phone, no app) ---------------
  // All three or nothing: webpush-config.ts hides the feature unless every one is set
  // and well formed. Checked here so a half-set pair is reported, not silently off.
  {
    name: 'WEBPUSH_VAPID_PUBLIC_KEY',
    class: 'push',
    whenMissing: 'Order updates on the phone (Web Push) stay hidden: no service worker, no prompt, no sends. Email and text still go.',
    check: (v) => (/^[A-Za-z0-9_-]{86,88}$/.test(v.trim()) ? null : 'must be the base64url VAPID public key (65 bytes) from `npx web-push generate-vapid-keys`'),
  },
  {
    name: 'WEBPUSH_VAPID_PRIVATE_KEY',
    class: 'push',
    whenMissing: 'As above.',
    check: (v) => (/^[A-Za-z0-9_-]{42,44}$/.test(v.trim()) ? null : 'must be the base64url VAPID private key (32 bytes) that pairs with the public key'),
  },
  {
    name: 'WEBPUSH_SUBJECT',
    class: 'push',
    whenMissing: 'As above.',
    check: (v) => (/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/.test(v.trim()) ? null : 'must be a mailto: address or an https:// URL'),
  },
  // --- optional ----------------------------------------------------------------------
  { name: 'PLATFORM_DOMAIN', class: 'optional', whenMissing: 'Defaults to skhokho.sgdataint.co.za.' },
  { name: 'ADMIN_DOMAIN', class: 'optional', whenMissing: 'Defaults to admin.<PLATFORM_DOMAIN>.' },
  { name: 'PLATFORM_OWNED_DOMAINS', class: 'optional', whenMissing: 'Only configured platform hosts are reserved from merchants.' },
  { name: 'BLOB_READ_WRITE_TOKEN', class: 'optional', whenMissing: 'Image uploads fail with a friendly message.' },
  { name: 'GOOGLE_MAPS_API_KEY', class: 'optional', whenMissing: 'No geocoding: per-km delivery pricing and the tracking map destination are unavailable.' },
  { name: 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', class: 'optional', whenMissing: 'The live delivery-tracking map does not render.' },
  // --- BulkSMS credentials (Tab 4, notify-sms) ---------------------------------------
  // The MESSAGE_PROVIDER switch itself is the single entry under "Customer phone
  // messaging" above. Appended at the end to keep this shared array append-only.
  {
    name: 'BULKSMS_TOKEN_ID',
    class: 'messaging',
    whenMissing: 'With MESSAGE_PROVIDER=bulksms this reads as unconfigured and nothing is sent — both halves of the token pair are required.',
  },
  { name: 'BULKSMS_TOKEN_SECRET', class: 'messaging', whenMissing: 'As above.' },
  {
    name: 'BULKSMS_WEBHOOK_TOKEN',
    class: 'messaging',
    whenMissing:
      'The delivery-report endpoint refuses every call (503), so sent texts never move to delivered or undelivered. Sending itself is unaffected.',
  },
  { name: 'BULKSMS_SENDER', class: 'optional', whenMissing: 'Texts go out from the BulkSMS account default sender.' },
  {
    name: 'SMS_DAILY_CAP_PER_BUSINESS',
    class: 'optional',
    whenMissing: 'Defaults to 500 texts per business per South African day.',
    // Mirrors dailyCap() in lib/messaging/message-log.ts, which also falls back
    // to the default rather than to zero: a typo here must not silently stop
    // every notification on the platform.
    check: (v) => {
      const n = Number(v.trim())
      return Number.isInteger(n) && n >= 0 ? null : `is "${v}" — expected a non-negative whole number of messages.`
    },
  },
]

export interface EnvReport {
  /** Missing or invalid startup variables — production refuses to start. */
  fatal: string[]
  /** Missing feature variables — the feature is disabled. */
  disabled: string[]
}

export function validateEnvironment(env: Record<string, string | undefined> = process.env): EnvReport {
  const fatal: string[] = []
  const disabled: string[] = []
  for (const v of ENV_VARS) {
    const value = env[v.name]
    if (!value) {
      if (v.class === 'startup') fatal.push(`${v.name} is not set — ${v.whenMissing}`)
      else if (v.class !== 'optional') disabled.push(`${v.name} (${v.class}): ${v.whenMissing}`)
      continue
    }
    const problem = v.check?.(value)
    if (problem) (v.class === 'startup' ? fatal : disabled).push(`${v.name} ${problem}`)
  }
  return { fatal, disabled }
}

/** True on Vercel production deployments (not previews, not local). */
/** The values provider.ts has a case for; MESSAGE_PROVIDER is checked against this list. */
const MESSAGE_PROVIDERS = ['console', 'bulksms', 'whatsapp']

export function isProductionDeployment(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === 'production'
}
