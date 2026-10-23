/**
 * Auth Service
 *
 * Password hashing and JWT issue/verify for the three actor types:
 *
 *   platform_admin  — Skhokho staff running the platform
 *   staff           — an employee of a single tenant business
 *   platform_user   — a customer with a cross-tenant Skhokho account
 *
 * JWTs are signed with `jose` (Web Crypto) rather than `jsonwebtoken` so the
 * same helpers work in Route Handlers, Server Components and Edge middleware.
 */

import bcrypt from 'bcryptjs'
import { createHash } from 'node:crypto'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

// ---------------------------------------------------------------------------
// Token payloads
// ---------------------------------------------------------------------------

export interface PlatformAdminToken {
  type: 'platform_admin'
  adminId: string
  platformId: string
  email: string
  /** True only when issued after a TOTP or recovery-code check. requireAdmin refuses anything else. */
  mfa?: boolean
  /** platform_admins.session_epoch at issue time — an MFA reset or role change ends older sessions. */
  epoch?: number
}

/**
 * The step BETWEEN password and MFA: proves the password only, and can do
 * nothing except enrol or verify a second factor. Short-lived, own cookie.
 */
export interface AdminMfaToken {
  type: 'admin_mfa'
  adminId: string
  email: string
  epoch: number
}

export interface StaffToken {
  type: 'staff'
  staffId: string
  tenantId: string
  email: string
  isOwner: boolean
}

export interface PlatformUserToken {
  type: 'platform_user'
  userId: string
  email?: string
  phone?: string
}

/** A Skhokholetha driver: an AppUser acting through their DriverProfile. */
export interface DriverToken {
  type: 'driver'
  userId: string
  driverId: string
  email: string
}

/**
 * A storefront customer who proved they hold a phone number (or, as the
 * fallback, an email address) by typing back a one-time code. The session
 * carries that VERIFIED IDENTIFIER and nothing else — never customers.id
 * (the global Skhokho id). The same number is a separate `customers` row at
 * every business (register_customer never links unverified numbers), so
 * "my orders at this shop" is always resolved per business from the
 * identifier (customer-account.service.ts), which keeps the account
 * per-business by construction until the POPIA s57 cross-business layer is
 * authorised.
 */
export interface CustomerToken {
  type: 'customer'
  channel: 'phone' | 'email'
  /** E.164 phone (+27…) or a lower-cased email address. */
  identifier: string
}

export type TokenPayload = PlatformAdminToken | StaffToken | PlatformUserToken | DriverToken | AdminMfaToken | CustomerToken

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ISSUER = 'skhokho-platform'

/** Seconds. Overridable per actor type via env. */
export const SESSION_TTL = {
  platform_admin: Number(process.env.ADMIN_SESSION_TTL ?? 43_200), // 12 hours
  admin_mfa: 600, // 10 minutes to enter the code
  staff: Number(process.env.STAFF_SESSION_TTL ?? 604_800), // 7 days
  platform_user: Number(process.env.PLATFORM_USER_SESSION_TTL ?? 2_592_000), // 30 days
  driver: Number(process.env.DRIVER_SESSION_TTL ?? 604_800), // 7 days
  customer: Number(process.env.CUSTOMER_SESSION_TTL ?? 2_592_000), // 30 days — a phone, not a shared till
} as const

/** Cookie name per actor type — mirrors the guards in @/lib/auth/guards. */
export const COOKIE_NAME = {
  platform_admin: 'skhokho-admin-token',
  admin_mfa: 'skhokho-admin-mfa',
  staff: 'skhokho-staff-token',
  platform_user: 'skhokho-user-token',
  driver: 'skhokho-driver-token',
  // Its own cookie: a customer signed in on the owner's phone never gets the
  // owner's session, and the dashboard guards never read this one.
  customer: 'skhokho-customer-token',
} as const

let cachedSecret: Uint8Array | null = null

function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret

  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be set to at least 32 characters. Generate one with: openssl rand -base64 64',
    )
  }

  cachedSecret = new TextEncoder().encode(secret)
  return cachedSecret
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

const BCRYPT_ROUNDS = 12

export async function hashPassword(plaintext: string): Promise<string> {
  if (!plaintext || plaintext.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS)
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  if (!plaintext || !hash) return false
  return bcrypt.compare(plaintext, hash)
}

/**
 * Hashes a password-reset / staff-invite token before it's stored, so a
 * database read (or leak) never exposes a usable credential — only the
 * raw token in the emailed link can complete the flow. SHA-256, not bcrypt:
 * the token is already a 256-bit `crypto.randomBytes` value (high-entropy,
 * not human-chosen), and completing the flow needs a `WHERE resetToken =
 * <hash>` lookup, which requires a deterministic hash — bcrypt's per-call
 * salt makes it unusable for equality lookups, only for a fetch-then-compare
 * pattern this call site doesn't have (there's no "the" row to compare
 * against until the hash has already identified it).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export async function signToken(payload: TokenPayload, ttlSeconds?: number): Promise<string> {
  const ttl = ttlSeconds ?? SESSION_TTL[payload.type]
  const now = Math.floor(Date.now() / 1000)

  return new SignJWT({ ...payload } as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(getSecret())
}

/** Throws if the token is missing, malformed, expired or has an unknown `type`. */
export async function verifyToken(token: string): Promise<TokenPayload> {
  if (!token) throw new Error('No token provided')

  const { payload } = await jwtVerify(token, getSecret(), { issuer: ISSUER })

  switch (payload.type) {
    case 'platform_admin':
      if (!payload.adminId) throw new Error('Malformed platform_admin token')
      return {
        type: 'platform_admin',
        adminId: String(payload.adminId),
        platformId: String(payload.platformId ?? ''),
        email: String(payload.email ?? ''),
        mfa: payload.mfa === true,
        epoch: typeof payload.epoch === 'number' ? payload.epoch : undefined,
      }

    case 'admin_mfa':
      if (!payload.adminId || typeof payload.epoch !== 'number') throw new Error('Malformed admin_mfa token')
      return { type: 'admin_mfa', adminId: String(payload.adminId), email: String(payload.email ?? ''), epoch: payload.epoch }

    case 'staff':
      if (!payload.staffId || !payload.tenantId) throw new Error('Malformed staff token')
      return {
        type: 'staff',
        staffId: String(payload.staffId),
        tenantId: String(payload.tenantId),
        email: String(payload.email ?? ''),
        isOwner: Boolean(payload.isOwner),
      }

    case 'platform_user':
      if (!payload.userId) throw new Error('Malformed platform_user token')
      return {
        type: 'platform_user',
        userId: String(payload.userId),
        email: payload.email ? String(payload.email) : undefined,
        phone: payload.phone ? String(payload.phone) : undefined,
      }

    case 'driver':
      if (!payload.userId || !payload.driverId) throw new Error('Malformed driver token')
      return {
        type: 'driver',
        userId: String(payload.userId),
        driverId: String(payload.driverId),
        email: String(payload.email ?? ''),
      }

    case 'customer':
      if ((payload.channel !== 'phone' && payload.channel !== 'email') || !payload.identifier) {
        throw new Error('Malformed customer token')
      }
      return { type: 'customer', channel: payload.channel, identifier: String(payload.identifier) }

    default:
      throw new Error(`Unknown token type: ${String(payload.type)}`)
  }
}

/** Cookie options for a freshly issued session token. */
export function sessionCookieOptions(type: TokenPayload['type']) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL[type],
  }
}
