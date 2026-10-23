/**
 * Web Push configuration — the VAPID key pair that identifies THIS
 * deployment to the browsers' push services, read from the environment:
 *
 *   WEBPUSH_VAPID_PUBLIC_KEY   base64url, 65-byte uncompressed P-256 point
 *   WEBPUSH_VAPID_PRIVATE_KEY  base64url, 32-byte scalar
 *   WEBPUSH_SUBJECT            mailto: address or https URL the push
 *                              service may contact about abuse
 *
 * Generate a pair once with `npx web-push generate-vapid-keys` and keep it
 * for the life of the deployment: every subscription is bound to the public
 * key, so rotating it silently drops every customer who said yes.
 *
 * Unset or malformed: the whole feature is hidden — no service worker is
 * registered, no prompt is shown, no send is attempted — and env-check
 * reports it. The private key never leaves this module except to the
 * sender; pages only ever receive the public key.
 */

const BASE64URL = /^[A-Za-z0-9_-]+$/

export interface WebPushConfig {
  publicKey: string
  privateKey: string
  subject: string
}

export function readWebPushConfig(env: Record<string, string | undefined> = process.env): WebPushConfig | null {
  const publicKey = (env.WEBPUSH_VAPID_PUBLIC_KEY ?? '').trim()
  const privateKey = (env.WEBPUSH_VAPID_PRIVATE_KEY ?? '').trim()
  const subject = (env.WEBPUSH_SUBJECT ?? '').trim()
  if (!publicKey || !privateKey || !subject) return null
  // 65 bytes → 87 base64url chars (88 with padding stripped off by most generators); 32 bytes → 43.
  if (publicKey.length < 86 || publicKey.length > 88 || !BASE64URL.test(publicKey)) return null
  if (privateKey.length < 42 || privateKey.length > 44 || !BASE64URL.test(privateKey)) return null
  if (!/^mailto:[^@\s]+@[^@\s]+$/.test(subject) && !/^https:\/\/\S+$/.test(subject)) return null
  return { publicKey, privateKey, subject }
}

/** Whether Web Push can run in this deployment (drives registration, the prompt and the account page section). */
export function isWebPushConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return readWebPushConfig(env) !== null
}

/** The only part of the configuration a page may receive. Null hides the feature. */
export function webPushPublicKey(env: Record<string, string | undefined> = process.env): string | null {
  return readWebPushConfig(env)?.publicKey ?? null
}
