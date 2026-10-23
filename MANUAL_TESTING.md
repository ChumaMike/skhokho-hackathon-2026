# Skhokho V1 — Owner Manual Test Plan

For the person who owns the product, not the code. You need a browser and
two throwaway email addresses / phone numbers (one for "Business A", one for
"Business B" — test 12 needs both to exist at once).

**Production URL** (once deployed): `https://skhokho.sgdataint.co.za`
As of this writing that domain is not yet live — see the release report for
why. Until then, run these same steps against whatever Preview URL you were
given; every step below works identically on Preview.

For each test: do the **Steps**, check the **Expected result**. If you don't
see that, it's a **Failure** — note what you saw instead and check
**Where to look**.

---

### TEST 1 — Homepage loads
**Steps**: Open the production URL in a normal (non-incognito) browser tab.
**Expected**: The Skhokho landing page loads — hero section, a way to
register a business, no error screen.
**Failure**: Blank page, Vercel error page, or a Next.js error overlay.
**Where to look**: Vercel → project → Deployments → the Production
deployment → Runtime Logs.

### TEST 2 — Register a new business ("Business A")
**Steps**: From the homepage, find the registration entry point (`/join`).
Fill it in with a real-looking business name, your email, a password.
Submit.
**Expected**: You land in the dashboard (`/dashboard`) as the owner of a
brand-new, empty business.
**Failure**: Error on submit, redirect loop, or you land on a business that
already has other people's data in it.
**Where to look**: Runtime logs for the `/api/platform/register` route;
confirm in the database that a new `Business` row with your name was created
alone, not merged into an existing one.

### TEST 3 — Log out and log back in
**Steps**: Log out. Go to `/login`. Enter the same email/password from
Test 2.
**Expected**: You're back in the same business's dashboard — same name, same
(still empty) data.
**Failure**: Wrong business, "user not found," or session doesn't persist
(gets logged out immediately after login).
**Where to look**: Cookies for the domain in devtools (Application tab) —
confirm a session cookie is actually being set.

### TEST 4 — Create a product or service
**Steps**: In the dashboard, go to Catalog (`/dashboard/catalog`). Add one
product (or one service, if this business does bookings). Give it a name,
price, and — if you want to test uploads — a photo.
**Expected**: It appears in the catalog list immediately. If you added a
photo and see a "not set up yet" message, that's expected unless Blob
storage has been configured for Production (see the env var table in the
release report) — the rest of the product should still save.
**Failure**: Save fails outright, or the whole form errors because of the
photo.
**Where to look**: Runtime logs around the save action.

### TEST 5 — Open the public storefront
**Steps**: From the dashboard, find this business's public storefront link
(`/store/<their-slug>`) and open it in a new incognito window (so you're not
logged in).
**Expected**: The product/service from Test 4 is visible to a stranger,
branded with this business's name — and *no* dashboard/admin access is
reachable from this page without logging in.
**Failure**: 404, empty catalog, or the storefront shows another business's
products.

### TEST 6 — Create a customer booking or order
**Steps**: Still incognito, on the storefront, place an order or book the
service from Test 4 as if you were a customer. Use a real-looking name and
phone number.
**Expected**: You get a confirmation on-screen. If this is an order with
online payment, you should land on a PayFast page (sandbox, unless real
merchant credentials are configured — see release report) rather than a
broken payment screen.
**Failure**: The flow errors out, or an online-payment order silently
"succeeds" with no actual payment step.

### TEST 7 — Verify the order/booking appears in the dashboard
**Steps**: Back in the logged-in dashboard tab, check Orders
(`/dashboard/orders`) or Appointments (`/dashboard/appointments`).
**Expected**: The Test 6 order/booking is there, with the right customer
name/phone.
**Failure**: Missing, or shows a different business's booking.

### TEST 8 — Loyalty stamp and redeem
**Steps**: In Customers (`/dashboard/customers`), find the customer from
Test 6 (or add one manually). Stamp a visit. Repeat until you can redeem a
reward, then redeem it.
**Expected**: Stamp count goes up by exactly one per stamp; redeeming resets
the count as designed and the redemption shows in that customer's history.
**Failure**: Stamps don't count, count goes up by more than one per click,
or you can redeem without enough stamps.

### TEST 9 — Invite a staff member
**Steps**: Go to Staff (`/dashboard/staff`), invite a team member with a
real email address you can check.
**Expected**: The dashboard says the invite was sent. **Then actually check
that inbox.** If `RESEND_API_KEY` isn't configured in Production yet, the
email will *not* arrive even though the dashboard says it did — this is a
known current gap, see the release report. In that case, treat this test as
FAILED for pilot readiness even though the UI looked fine.
**Failure**: Dashboard errors on invite, or (silently) no email ever
arrives and there's no other way to get the invited person into the
account.
**Where to look**: Runtime logs will show `[email] RESEND_API_KEY not set —
would have sent to <address>` if this is the cause.

### TEST 10 — Verify staff permissions
**Steps**: Once the invited staff member has a password set (via the email
link, or however Test 9 actually got them access), log in as them in a
separate browser/incognito window. Try an action they shouldn't be able to
do (e.g. removing another staff member, if they weren't given that
permission).
**Expected**: Blocked with a clear permission error, not a silent no-op or
a crash.
**Failure**: They can do something they shouldn't, or the app crashes
instead of a clean permission denial.

### TEST 11 — Domain settings (safe check only)
**Steps**: Go to `/dashboard/settings/domains`. Try adding a domain you
don't actually own, e.g. `test-example-domain.co.za`.
**Expected**: It's accepted as PENDING with verification instructions —
this feature is intentionally **stubbed** for V1 (see release report), so
don't expect it to actually go live or issue a certificate. Don't attempt
to point a real DNS record at this unless the release report says the
domain provider integration is no longer stubbed.
**Failure**: The app claims the domain is ACTIVE/verified without you doing
any DNS work — that would be a real bug, since it isn't supposed to be
possible yet.

### TEST 12 — Tenant isolation (needs Business A and Business B)
**Steps**: Register a second business ("Business B") with a different email
(Test 2's steps again). While logged in as Business B, try to reach
anything belonging to Business A — its dashboard URLs, its customer list,
its orders — by guessing/editing URLs if you're comfortable doing that, or
just confirm Business B's dashboard never shows Business A's data anywhere.
**Expected**: Business B sees only Business B's data, everywhere, always.
**Failure**: Any cross-over — Business B dashboard shows Business A
customers/orders/staff/products.
**Where to look**: This is the single most important test in this whole
list. If it fails, stop the pilot and escalate immediately.

### TEST 13 — Logout/login persistence
**Steps**: Log out of Business A. Close the browser entirely (not just the
tab). Reopen it and go straight to `/dashboard`.
**Expected**: You're asked to log in again (not silently let back in, and
not stuck in a redirect loop).
**Failure**: Redirect loop, or you're let in without a password.

### TEST 14 — Mobile view
**Steps**: Open the storefront (Test 5's link) on an actual phone, or with
your browser's device-emulation view set to a small screen (~375px wide).
**Expected**: Usable without horizontal scrolling; buttons are tappable;
text is readable without zooming. Most South African users here are on
Android — prioritize that over iOS quirks if the two disagree.
**Failure**: Horizontal scroll, overlapping text, unreachable buttons.

### TEST 15 — Slow connection
**Steps**: In Chrome DevTools → Network tab, throttle to "Slow 4G," then
reload the storefront and place a test order (Test 6 again).
**Expected**: Loading states are visible (not a blank white screen for
several seconds), and the order still completes.
**Failure**: Blank screen with no loading indicator, or the order silently
fails without telling the customer.

### TEST 16 — Payment (if configured)
**Steps**: Only if the release report says PayFast is READY with real
merchant credentials — place a real small-value order and complete payment
with a real card.
**Expected**: Payment completes, order status updates to paid, PayFast's
ITN webhook is confirmed in the runtime logs.
**Failure**: Anything left in a "paid but order still shows unpaid" or
"charged but no order" state — this is a money-handling bug, treat as
critical.
**If PayFast is still sandbox-only**: skip the real payment, but confirm
the sandbox flow (Test 6) completes end-to-end without errering out.

### TEST 17 — Email (if configured)
**Steps**: Only if the release report says email is READY (`RESEND_API_KEY`
present in Production) — trigger a password reset (`/forgot-password`) for
a real inbox you control.
**Expected**: Email arrives within a couple of minutes, reset link works,
and you can set a new password and log in with it.
**Failure**: No email, broken link, or the link doesn't actually let you in
afterward.

### TEST 18 — Upload (if configured)
**Steps**: Only if the release report says Blob storage is READY — upload a
real photo to a product (Test 4 again, this time actually attaching an
image).
**Expected**: Image appears on the storefront (Test 5) exactly where it
should, isn't oversized, and isn't visible to any other business.
**Failure**: Upload errors, image doesn't appear, or an unrelated business
can see/reach the uploaded file's URL.

---

## If something fails

1. Note which test number, what you did, and what you saw (a screenshot
   helps).
2. Check the "Where to look" pointer for that test if one's given.
3. For anything involving money (Test 6, 16) or tenant isolation (Test 12),
   treat it as urgent — stop testing further real-merchant flows until it's
   understood.
