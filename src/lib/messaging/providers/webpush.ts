/**
 * Web Push provider — delivers one small JSON payload to one browser
 * subscription through its push service (FCM for Android Chrome, Apple's
 * for an installed iPhone web app, Mozilla's for Firefox), signed with this
 * deployment's VAPID keys and encrypted to the browser's keys (RFC 8291 /
 * 8292, via the `web-push` library).
 *
 * Selected by src/lib/messaging/provider.ts when the VAPID variables are
 * set; it is a second KIND of provider beside the phone one, not a value of
 * MESSAGE_PROVIDER. Same discipline as the phone providers: never throws,
 * never logs an endpoint or a payload, and only the push service's
 * acceptance counts as sent. A 404 or 410 means that browser is gone for
 * good and the caller forgets its subscription.
 */

import webpush, { WebPushError, type SendResult } from 'web-push'
import type { MessageKind } from '../provider'
import type { WebPushConfig } from '../webpush-config'

/** What the service worker shows (public/sw.js). `url` is a path on the storefront's own origin. */
export interface PushPayload {
  title: string
  body: string
  url: string
  /** Same tag → the newer notification replaces the older one (one card per order). */
  tag: string
}

/** One browser, as stored by push-subscriptions.service. */
export interface PushTarget {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushSendContext {
  /** The shop this message is about — for per-shop volume later, never in the payload. */
  businessId: string
  kind: MessageKind
}

export interface PushSendResult {
  accepted: boolean
  /** The push service says this browser no longer exists (404/410): forget the subscription. */
  gone: boolean
  errorName?: string | null
}

export interface PushProvider {
  readonly name: string
  send(target: PushTarget, payload: PushPayload, context: PushSendContext): Promise<PushSendResult>
}

/** The library call, injectable so tests never reach a push service. */
export type PushTransport = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { vapidDetails: WebPushConfig & { subject: string }; TTL: number; urgency: 'high' | 'normal'; topic?: string },
) => Promise<SendResult>

/** A day: an update is still worth seeing when the phone comes back online tonight, not next week. */
const TTL_SECONDS = 24 * 60 * 60

/** Encodes the payload exactly as the service worker reads it. Kept tiny — push services cap payloads around 4 KB. */
export function encodePushPayload(payload: PushPayload): string {
  return JSON.stringify({ title: payload.title, body: payload.body, url: payload.url, tag: payload.tag })
}

/** Topic header: a short token that lets the push service collapse unseen updates for the same order. */
function topicFor(tag: string): string | undefined {
  const t = tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  return t.length > 0 ? t : undefined
}

export function createWebPushProvider(config: WebPushConfig, transport: PushTransport = defaultTransport): PushProvider {
  return {
    name: 'webpush',
    async send(target, payload, _context) {
      void _context // attribution only; nothing from it goes to the push service
      try {
        const result = await transport(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          encodePushPayload(payload),
          { vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey }, TTL: TTL_SECONDS, urgency: 'high', topic: topicFor(payload.tag) },
        )
        const ok = result.statusCode >= 200 && result.statusCode < 300
        return ok ? { accepted: true, gone: false } : { accepted: false, gone: false, errorName: `webpush_${result.statusCode}` }
      } catch (e) {
        const status = e instanceof WebPushError ? e.statusCode : typeof (e as { statusCode?: unknown })?.statusCode === 'number' ? (e as { statusCode: number }).statusCode : null
        if (status === 404 || status === 410) return { accepted: false, gone: true, errorName: `webpush_${status}` }
        return { accepted: false, gone: false, errorName: status ? `webpush_${status}` : e instanceof Error ? e.name : 'unknown' }
      }
    },
  }
}

const defaultTransport: PushTransport = (subscription, payload, options) =>
  webpush.sendNotification(subscription, payload, {
    vapidDetails: options.vapidDetails,
    TTL: options.TTL,
    urgency: options.urgency,
    ...(options.topic ? { topic: options.topic } : {}),
  })
