# Skhokho Platform — design direction

Binding for all tenant-facing UI. Derived from the subject, not from a template.

## Who this is for

A salon owner, barber, spaza shopkeeper, shisa nyama or car wash owner in South
Africa. Mid-range Android, often on limited data, often standing behind a counter
with one hand free. **Mobile-first is not a nicety here — it is the only view that
matters.** Desktop is the secondary case.

The dashboard's single job: **know who your regulars are and keep them coming back.**

## Signature element — the stamp card

The memorable thing on this platform is the **loyalty card**, because it is the
artifact these businesses already use: a paper card in a wallet, punched at the
counter, dog-eared.

- A customer renders as a card with N stamp slots (N = the business's
  `loyalty_stamps_required`).
- Filled slots are amber discs, each with a **small random rotation (-8° to +8°)
  and 1–2px offset** — a real rubber stamp never lands square. The seed is the
  membership id, so a given card looks identical on every render.
- Empty slots are dashed outlines in `edge`.
- Tapping an empty slot stamps it: 120ms press-down, then the disc settles.
- When the last slot fills, the card turns `veld` and reads **Reward ready**.
- The pairwise **short code** sits on the card in mono — it is read aloud across a
  counter, so it must be unambiguous and copyable.

Spend the boldness here. Everything else stays quiet.

## Colour

Warm near-black ground with amber — a shopfront at dusk. Accents come from
hand-painted enamel signage, not from a generic accent ramp.

| Token | Hex | Use |
|---|---|---|
| `ink` | `#0E0A05` | page ground |
| `board` | `#171009` | cards, raised surfaces |
| `edge` | `#2E2011` | borders, empty stamp slots |
| `amber` | `#E8A020` | primary action, filled stamps, brand |
| `veld` | `#5B8C3A` | reward ready, success |
| `oxide` | `#C8452F` | destructive, lapsed customers, errors |
| `chalk` | `#F5EFE6` | primary text |
| `dust` | `#8A7B68` | secondary text, labels |

**`#1DB954` is banned.** It was in the original `/join` and it is Spotify's green —
borrowed, not chosen. `veld` replaces it everywhere. This still holds after the
2026-08 Skhokho-marketplace merge: skhokho-labs' UI *patterns* (kente-strip
dividers, adinkra background texture, card hover-lift, gradient text, a
shadcn/ui-style component kit) were ported into this app — recoloured to this
palette — but its gold/fire/green brand colours were not. Every Tailwind
utility and shadcn semantic variable (`bg-primary`, `bg-card`, `text-foreground`,
etc., see `globals.css`'s `@theme` block) resolves back to the eight tokens in
this table. If a ported component still shows gold, fire, or Spotify green,
that is a bug, not a style choice.

## Type

Loaded via `next/font/google`, self-hosted at build — no external requests.

- **Display — Archivo Black.** Headings, the business name, big numbers. Heavy and
  wide, like enamel lettering painted on a wall. Used with restraint: page titles
  and the one number that matters, nothing else.
- **Body — Archivo.** All prose, labels, buttons. Holds up at 14px on a cheap
  Android screen.
- **Data — Space Mono.** Short codes, phone numbers, order numbers only. Mono earns
  its place where a string gets read aloud or typed, and nowhere else.

Scale: 12 / 14 / 16 / 20 / 28 / 40. Sentence case everywhere. No all-caps except
eyebrow labels at 12px with `letter-spacing: .08em`.

## Layout

The 2026-09 Connected Shopfront redesign made explicit what had been implicit: this
platform is really **three surfaces**, each shaped by who stands in front of it, not
one layout stretched to fit every screen.

**Customer storefront + checkout** (`/store/[slug]/*`) — mobile-first below, but
not uniformly narrow on desktop; the two surfaces under this heading widen
differently, deliberately:
- **Browsing** (`/store/[slug]` itself, `StorefrontView.tsx`) opts into `.column.wide`
  — a single column up to `860px`, then up to `1280px` on desktop, the same
  hybrid-layout class the marketing pages use. This is a real catalogue to browse,
  not a form to fill in, so it gets room to breathe: since Phase 6, `ProductsSection`
  renders products as a photo-forward card **grid** (one column on a phone, two once
  `.column.wide` actually has the room, at `860px`), while `ServicesSection` stays a
  single-column, duration-forward list at every width — a service card carries more
  to scan (description, duration, a date/time picker) than a product card does, so a
  grid would cram it, not clarify it.
- **Basket, configurator and checkout** (`/store/[slug]/{basket,configure/[id]}`,
  `CheckoutShell`) stay on the narrower, single-column `520px` app-form pattern —
  "a phone app that happens to run in a browser" — because these are forms to
  complete, not a catalogue to browse. Checkout has its own single further
  exception: it widens to `900px` two-column above `860px` (`CheckoutShell`'s `wide`
  prop) so the order — items, total, the place-order action — sits in a sticky
  right-hand card while the customer fills in fulfilment/contact/consent on the
  left; below `860px` it collapses back to the single `520px` column,
  order-summary-first. Basket and the configurator stay at the plain `520px` width
  always; only checkout gets the wider rail.
- Across both: **bottom action bar, fixed**, thumb-reachable where one applies —
  the primary action of the current screen lives there, not at the top. Cards:
  `border-radius: 14px`, 1px `edge` border, no drop shadows (they read as cheap on
  OLED and cost battery). Touch targets ≥ 44px.
- A business's **storefront look also now takes a sensible starting point from its
  category** (`storefront-theme.ts`'s `CATEGORY_DEFAULT_PRESET` — e.g. Food starts
  WARM, Salon starts PREMIUM, Car Wash/Mechanic start BOLD) rather than every new
  business defaulting to the same WARM/MINIMAL look regardless of what they sell.
  This is only ever a *starting* preset: the moment an owner saves their own choice
  in the Storefront Design Wizard, that choice is the only thing read from then on —
  category never overrides a real saved setting.

**Business console** (`/dashboard/*`, owner/manager desktop work) — desktop-first by
design, the opposite bias from the storefront:
- Grouped sidebar nav (`BusinessConsoleNav`), warm-chalk workspace — the app's normal
  dark tokens are pinned to lighter values here (`globals.css`,
  `body:has(.console-sidebar-anchor) .shell`) because a shopkeeper doing paperwork at
  a desk reads better on a bright surface than the storefront's dusk palette.
- Wide layouts (up to `1440px`) for list/detail splits — orders, appointments,
  analytics — reading real content side-by-side rather than one column of navigation.
- Collapses to `DashboardNav`'s bottom bar only below the sidebar's breakpoint; it is
  a fallback for a phone catching up on the dashboard, not the primary design target.

**Operational staff surfaces** (`/dashboard/{kitchen,counter,deliveries,driver}`) —
task-shaped, not phone-shaped and not desktop-shaped: a kitchen ticket board, a POS
grid, a dispatch board. Touch targets ≥ 44px here specifically because these are
worked from a counter or a moving hand, the same reasoning as the storefront's rule
above but for staff instead of customers.

## Copy

Plain, warm South African English. Name things as the owner would say them:
"Give a stamp", not "Increment loyalty counter". "Hasn't been in for a while", not
"Churned segment". Buttons say what happens — "Give a stamp" produces "Stamp
given". Errors say what broke and what to do; they do not apologise. An empty
screen invites the first action: "No customers yet. Add your first one and start
their card."

## Quality floor

Responsive to 320px · visible keyboard focus rings in `amber` ·
`prefers-reduced-motion` respected (the stamp settle becomes an instant state
change) · no layout shift on load · every colour pair meets 4.5:1 on `ink`.
