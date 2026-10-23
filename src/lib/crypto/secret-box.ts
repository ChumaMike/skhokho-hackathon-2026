import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Authenticated encryption for secrets held at rest.
 *
 * Built because this repo had no encryption utility of any kind — only MD5
 * (PayFast signatures) and SHA-256 (reset-token hashing). It exists for
 * merchant payment credentials: a PayFast merchant key and passphrase are
 * bearer secrets that let anyone holding them take payment into that
 * merchant's account, so they must never sit in a readable column, and
 * emphatically never in `Business.settings` — that JSON is selected wholesale
 * by several ordinary reads, including getStaffWorkspaceContext.
 *
 * AES-256-GCM, so ciphertext is tamper-evident rather than merely unreadable:
 * a modified byte fails the authentication tag instead of decrypting to
 * plausible rubbish that would then be sent to a payment gateway.
 *
 * Key material lives only in the environment, never in the database. Storing
 * the wrapping key next to the wrapped secret protects against nothing.
 */

/** `PAYMENT_ENCRYPTION_KEY` is version 1; `PAYMENT_ENCRYPTION_KEY_V<n>` thereafter. */
const BASE_KEY_ENV = 'PAYMENT_ENCRYPTION_KEY'
const KEY_BYTES = 32 // AES-256
const IV_BYTES = 12 // GCM standard nonce length
const TAG_BYTES = 16

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretBoxError'
  }
}

function envNameForVersion(version: number): string {
  return version === 1 ? BASE_KEY_ENV : `${BASE_KEY_ENV}_V${version}`
}

/**
 * Reads and validates a key. Deliberately throws rather than falling back to a
 * derived or default key: a silent fallback would encrypt live merchant
 * credentials under something predictable, and nothing downstream would ever
 * notice.
 */
function keyForVersion(version: number): Buffer {
  const name = envNameForVersion(version)
  const raw = process.env[name]
  if (!raw) {
    throw new SecretBoxError(
      `${name} is not set. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    )
  }

  let key: Buffer
  try {
    key = Buffer.from(raw, 'base64')
  } catch {
    throw new SecretBoxError(`${name} is not valid base64.`)
  }
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError(`${name} must decode to exactly ${KEY_BYTES} bytes (got ${key.length}).`)
  }
  return key
}

/**
 * The version new ciphertext is written under — the highest `_V<n>` present,
 * else 1. Rotation is therefore: add `PAYMENT_ENCRYPTION_KEY_V2`, keep V1 set
 * so existing rows still decrypt, and re-encrypt on next write. Old key
 * material is only removed once nothing references that version.
 */
export function currentKeyVersion(): number {
  let highest = 0
  for (const name of Object.keys(process.env)) {
    if (name === BASE_KEY_ENV) {
      highest = Math.max(highest, 1)
      continue
    }
    const match = /^PAYMENT_ENCRYPTION_KEY_V(\d+)$/.exec(name)
    if (match && process.env[name]) highest = Math.max(highest, Number(match[1]))
  }
  if (highest === 0) {
    throw new SecretBoxError(`${BASE_KEY_ENV} is not set — no encryption key is configured.`)
  }
  return highest
}

export interface SealedSecret {
  /** Opaque, self-describing: `v<version>.<iv>.<tag>.<ciphertext>`, all base64. */
  payload: string
  /** Stored alongside so a row can be found for re-encryption without parsing. */
  keyVersion: number
}

/**
 * The version travels inside the payload AND is returned separately on
 * purpose: inside so a value is self-describing wherever it ends up, and
 * outside so rows needing re-encryption can be found with a plain indexed
 * query rather than by parsing every row.
 */
export function encryptSecret(plaintext: string): SealedSecret {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new SecretBoxError('Refusing to encrypt an empty secret.')
  }
  const version = currentKeyVersion()
  const key = keyForVersion(version)
  const iv = randomBytes(IV_BYTES)

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    payload: [
      `v${version}`,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join('.'),
    keyVersion: version,
  }
}

/**
 * Decrypts under whichever key version the payload names, so rows written
 * before a rotation keep working. Every failure is the same opaque error:
 * distinguishing "wrong key" from "tampered tag" to a caller tells an attacker
 * which of the two they achieved.
 */
export function decryptSecret(payload: string): string {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new SecretBoxError('Nothing to decrypt.')
  }
  const parts = payload.split('.')
  if (parts.length !== 4) {
    throw new SecretBoxError('Malformed sealed secret.')
  }
  const [versionPart, ivB64, tagB64, ciphertextB64] = parts

  const versionMatch = /^v(\d+)$/.exec(versionPart)
  if (!versionMatch) throw new SecretBoxError('Malformed sealed secret.')
  const version = Number(versionMatch[1])

  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretBoxError('Malformed sealed secret.')
  }

  const key = keyForVersion(version) // throws with a useful message if that version is gone
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new SecretBoxError('Could not decrypt: wrong key or the value has been tampered with.')
  }
}

/** True when `payload` needs re-encrypting under the current key. */
export function needsRotation(keyVersion: number): boolean {
  return keyVersion < currentKeyVersion()
}

/**
 * Constant-time compare for secrets that arrive from outside — a PayFast
 * signature, for instance. Length is compared first and non-constant-time
 * because the length of a hex digest is not the secret.
 */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
