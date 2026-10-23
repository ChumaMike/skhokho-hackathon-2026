import { test, expect, type Page } from "@playwright/test";

/**
 * Visual smoke gate. Credentials/slug match prisma/seed.ts's demo business
 * ("Beauty by Nomsa") — CI runs `db:deploy && db:seed` against a fresh
 * database before this suite starts (see .github/workflows/ci.yml's
 * visual-smoke job); locally, point PLAYWRIGHT_BASE_URL at a dev server
 * that has already been seeded the same way.
 */
const OWNER_EMAIL = "nomsa@beautybynomsa.co.za";
const OWNER_PASSWORD = "Owner@Salon2026!";
const STOREFRONT_SLUG = "beauty-by-nomsa";

/**
 * SlotPicker (storefront booking widget) is a client component whose date
 * input defaults to the browser's real "today" (src/components/storefront/
 * SlotPicker.tsx's todayISODate()), and the server's availability response
 * is keyed off whatever date the client sends — so storefront-home's
 * rendered content (which dates/times show as bookable) genuinely changes
 * every single day, making any committed screenshot baseline for this page
 * stale again within 24 hours regardless of how recently it was captured.
 *
 * Freezing only the BROWSER clock (what Playwright's page.clock controls)
 * fixes the date input's displayed value, but src/app/api/store/availability/
 * route.ts's own "is this slot still bookable" check is `t > now` against
 * that route's real, unmocked server-side `new Date()` — a date picked in
 * the past relative to whenever CI actually runs would make every slot that
 * day permanently unavailable ("No open times"), and a date too close to
 * "now" would drift in and out of availability as the day's open slots pass.
 * Far enough in the future that every 09:00-17:00 slot that day (the route's
 * DEFAULT_WINDOW — a fixed daily window, not day-of-week-dependent: see that
 * route's own comment on why Business.operatingHours isn't read yet) stays
 * "in the future" for years regardless of which real day this test runs on.
 */
const FIXED_TEST_TIME = new Date("2032-01-05T09:00:00Z");

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(OWNER_EMAIL);
  await page.locator("#password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/\/dashboard/);
}

// Every one of these previously shipped a real colour regression this
// session (see git log: console-contrast fix, modal dark-on-dark fix,
// metric-grid clipping fix) or is the equivalent unauthenticated surface
// (login, storefront) that never got any automated visual coverage either.
const AUTHENTICATED_PAGES = [
  { name: "dashboard-home", path: "/dashboard" },
  { name: "catalog", path: "/dashboard/catalog" },
  { name: "customers", path: "/dashboard/customers" },
  { name: "staff", path: "/dashboard/staff" },
];

const PUBLIC_PAGES = [
  { name: "login", path: "/login" },
  { name: "storefront-home", path: `/store/${STOREFRONT_SLUG}` },
];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} scheme`, () => {
    test.use({ colorScheme });

    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(FIXED_TEST_TIME);
    });

    for (const { name, path } of PUBLIC_PAGES) {
      test(`${name} (${colorScheme})`, async ({ page }) => {
        await page.goto(path);
        // The storefront renders product/banner images loaded after first
        // paint, which shift page height mid-screenshot and fail Playwright's
        // two-consecutive-stable-frames check — wait for the network to
        // settle first rather than racing it.
        await page.waitForLoadState("networkidle");
        await expect(page).toHaveScreenshot(`${name}-${colorScheme}.png`, { fullPage: true });
      });
    }

    for (const { name, path } of AUTHENTICATED_PAGES) {
      test(`${name} (${colorScheme})`, async ({ page }) => {
        await login(page);
        await page.goto(path);
        await expect(page).toHaveScreenshot(`${name}-${colorScheme}.png`, { fullPage: true });
      });
    }

    // The exact regression from PR #56: an Edit modal portalled outside
    // the console's light-palette wrapper, rendering dark text on a dark
    // background because a CSS Modules class went unmatched. Screenshotting
    // the OPEN modal, not just the page behind it, is the point.
    test(`catalog edit modal (${colorScheme})`, async ({ page }) => {
      await login(page);
      await page.goto("/dashboard/catalog");
      await page.getByRole("button", { name: "Edit" }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(page).toHaveScreenshot(`catalog-edit-modal-${colorScheme}.png`, { fullPage: true });
    });
  });
}
