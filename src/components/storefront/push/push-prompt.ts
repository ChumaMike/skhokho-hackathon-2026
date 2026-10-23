/**
 * When and how the "get order updates on this phone" offer appears — the
 * pure rules behind PushPrompt.tsx, kept out of the component so they can
 * be tested without a browser.
 *
 * The offer is shown ONCE, and only right after something the customer just
 * did (placed an order, signed in) — never on a first visit, never while
 * browsing. A dismissal is remembered per shop in this browser, so a
 * customer who said "not now" is not asked again at that shop.
 */

export type PushTrigger = 'order' | 'signin'

export interface PromptEnvironment {
  /** Push is configured for this deployment (a public key reached the page). */
  configured: boolean
  /** The browser has service workers, PushManager and Notification. */
  supported: boolean
  /** Notification.permission */
  permission: 'default' | 'granted' | 'denied'
  /** Safari on iPhone/iPad (push there works only once the site is on the Home Screen). */
  ios: boolean
  /** Running from the Home Screen (display-mode: standalone / navigator.standalone). */
  standalone: boolean
  /** The customer already said yes or no at this shop in this browser. */
  answered: boolean
  /** This browser is already subscribed (pushManager.getSubscription() returned one). */
  subscribed: boolean
}

export type PromptDecision = 'hidden' | 'offer' | 'ios-install-first'

export function decidePrompt(env: PromptEnvironment): PromptDecision {
  if (!env.configured || env.answered || env.subscribed) return 'hidden'
  if (env.permission === 'denied') return 'hidden'
  if (env.ios && !env.standalone) return 'ios-install-first'
  if (!env.supported) return 'hidden'
  return 'offer'
}

/** localStorage key remembering the customer's answer at ONE shop. */
export function promptStorageKey(businessId: string): string {
  return `skhokho:push-prompt:${businessId}`
}

/** sessionStorage key the login form sets so the account page shows the offer once after sign-in. */
export const SIGNIN_TRIGGER_KEY = 'skhokho:push-trigger'

/** The words on the offer, by what the customer just did. Plain, warm, honest about iPhones. */
export function promptCopy(trigger: PushTrigger, businessName: string, decision: Exclude<PromptDecision, 'hidden'>) {
  if (decision === 'ios-install-first') {
    return {
      heading: 'Order updates on your iPhone',
      body: `On an iPhone, updates can only reach you once ${businessName} is on your Home Screen. Tap Share, then "Add to Home Screen", open it from there, and we'll offer this again.`,
      yes: null as string | null,
      no: 'Not now',
    }
  }
  return {
    heading: trigger === 'order' ? 'Hear when your order moves' : 'Get order updates on this phone',
    body:
      trigger === 'order'
        ? `We can tell you on this phone when ${businessName} confirms your order, when it's ready and when it's on its way. No app needed, and you can switch it off from your account any time.`
        : `We can tell you on this phone when an order at ${businessName} is confirmed, ready or on its way. You can switch it off from your account any time.`,
    yes: 'Yes, tell me',
    no: 'Not now',
  }
}

/** Converts the base64url VAPID public key to the bytes PushManager.subscribe wants. */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url + '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  // Backed by a plain ArrayBuffer (not a SharedArrayBuffer), which is what PushManager.subscribe's type asks for.
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
