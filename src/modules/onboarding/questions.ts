import type { BusinessCategory } from '@prisma/client'

/**
 * The onboarding interview.
 *
 * Design constraint that drives every choice in this file: the person
 * answering has just registered, is probably on an Android phone, is
 * probably standing in their shop, and owes us nothing. So the interview is
 * built to be *tapped through*, not typed through — every question leads
 * with concrete options drawn from how these businesses actually operate,
 * and free text is always optional and always last.
 *
 * Six questions is the ceiling. Each one has to earn its place by changing
 * what we would build for them; anything we can infer from what they've
 * already given us (their category, their name) is pre-filled, not re-asked.
 */

export type QuestionKind = 'single' | 'multi'

export interface Question {
  id: string
  /** Asked in plain, warm South African English — no jargon. */
  prompt: string
  /** One short line under the prompt explaining why we're asking. */
  why: string
  kind: QuestionKind
  options: string[]
  /** Label for the always-optional free-text box under the options. */
  freeTextLabel: string
  freeTextPlaceholder: string
}

export const QUESTIONS: Question[] = [
  {
    id: 'sells',
    prompt: 'What do people actually buy from you?',
    why: 'This becomes the main thing your website shows off.',
    kind: 'multi',
    // Filled per-category by suggestionsFor() — see SELLS_BY_CATEGORY.
    options: [],
    freeTextLabel: 'Anything else you sell?',
    freeTextPlaceholder: 'e.g. kids cuts on Saturdays',
  },
  {
    id: 'ordering',
    prompt: 'How do customers reach you right now?',
    why: 'We build your site around the way people already contact you.',
    kind: 'multi',
    options: [
      'They just walk in',
      'WhatsApp',
      'Phone call',
      'Facebook or Instagram',
      'A delivery app',
      'Word of mouth only',
    ],
    freeTextLabel: 'Any other way?',
    freeTextPlaceholder: 'e.g. my regulars have my personal number',
  },
  {
    id: 'where',
    prompt: 'Where do you serve them?',
    why: 'Decides whether your site needs a map, a delivery area, or neither.',
    kind: 'single',
    options: [
      'At my shop or salon',
      'I travel to the customer',
      'I deliver',
      'Both — they come to me and I deliver',
      'Online only',
    ],
    freeTextLabel: 'Want to add detail?',
    freeTextPlaceholder: 'e.g. I only deliver in Soweto',
  },
  {
    id: 'busy',
    prompt: 'When are you busiest?',
    why: 'So your site can push bookings into your quiet times.',
    kind: 'multi',
    options: [
      'Weekday mornings',
      'Weekday afternoons',
      'Weekday evenings',
      'Saturdays',
      'Sundays',
      'Month-end',
      'It changes all the time',
    ],
    freeTextLabel: 'Anything seasonal?',
    freeTextPlaceholder: 'e.g. December is mad, January is dead',
  },
  {
    id: 'bottleneck',
    prompt: "What's the most annoying part of running it?",
    why: 'This is the part we try hardest to take off your hands.',
    kind: 'multi',
    options: [
      'Answering WhatsApp all day',
      'People book and then no-show',
      'Chasing customers for payment',
      'Stock runs out without warning',
      'Customers forget about me',
      'Too much admin and paperwork',
      'Finding new customers',
      'Staff not knowing what to do',
    ],
    freeTextLabel: 'Tell us more if you like',
    freeTextPlaceholder: 'e.g. I lose orders when the shop is full',
  },
  {
    id: 'goal',
    prompt: 'What do you want your website to do for you?',
    why: 'This decides which pages we build first.',
    kind: 'multi',
    options: [
      'Show my prices',
      'Take orders',
      'Take bookings',
      'Show people where I am',
      'Build a customer list',
      'Look professional',
      'Sell to people outside my area',
    ],
    freeTextLabel: 'Anything else you picture on it?',
    freeTextPlaceholder: 'e.g. photos of my work, and a page about me',
  },
]

/**
 * Category-specific answers for the "what do people buy from you" question.
 *
 * These exist so the very first question can be answered with two taps
 * instead of a paragraph. They are deliberately written the way a shop owner
 * would say them, not as catalogue nouns ("Braids", not "Hair Services").
 */
const SELLS_BY_CATEGORY: Partial<Record<BusinessCategory, string[]>> = {
  SALON: ['Braids', 'Cuts', 'Blow-dry & styling', 'Treatments', 'Colour', 'Weaves & wigs'],
  HAIR_BRAIDER: ['Box braids', 'Cornrows', 'Knotless braids', 'Twists', 'Takedown', 'Kids styles'],
  NAIL_TECHNICIAN: ['Gel overlay', 'Acrylics', 'Refills', 'Pedicure', 'Nail art', 'Soak-off'],
  FOOD_VENDOR: ['Kota', 'Chips', 'Burgers', 'Grilled chicken', 'Pap & meat', 'Cold drinks'],
  TUCK_SHOP: ['Bread & milk', 'Airtime & data', 'Cold drinks', 'Snacks', 'Cigarettes', 'Paraffin'],
  RETAIL_STORE: ['Clothing', 'Shoes', 'Accessories', 'Household goods', 'Electronics'],
  CAR_WASH: ['Full wash', 'Wash & polish', 'Inside only', 'Engine wash', 'Valet'],
  MECHANIC: ['Service', 'Brakes', 'Clutch', 'Diagnostics', 'Tyres', 'Panel beating'],
  EVENTS: ['Decor', 'Catering', 'Sound & DJ', 'Photography', 'Venue hire', 'Marquee hire'],
  CHILDCARE: ['Full day care', 'Half day', 'Aftercare', 'Holiday programme', 'Transport'],
  LAUNDRY: ['Wash & fold', 'Dry cleaning', 'Ironing', 'Duvets & blankets', 'Collection & delivery'],
}

const SELLS_FALLBACK = [
  'A product I make',
  'A product I resell',
  'A service I do by hand',
  'Something else',
]

/** The tap-first options for a question, tailored to the business category. */
export function suggestionsFor(questionId: string, category: BusinessCategory): string[] {
  if (questionId === 'sells') {
    return SELLS_BY_CATEGORY[category] ?? SELLS_FALLBACK
  }
  return QUESTIONS.find((q) => q.id === questionId)?.options ?? []
}

export type Answers = Record<string, string | string[]>

/** Every answer is optional — the interview must never trap someone on a step. */
export function isAnswered(answers: Answers, questionId: string): boolean {
  const v = answers[questionId]
  if (Array.isArray(v)) return v.length > 0
  return typeof v === 'string' && v.trim().length > 0
}

/** Flattens one answer to a readable phrase for prompts and the brief. */
export function answerText(answers: Answers, questionId: string): string {
  const v = answers[questionId]
  if (Array.isArray(v)) return v.join(', ')
  return typeof v === 'string' ? v : ''
}
