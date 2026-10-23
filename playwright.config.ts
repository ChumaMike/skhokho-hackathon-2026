import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

// See corporate-website/playwright.config.ts for the reasoning: invoking
// Next through `npx`/the pnpm shim leaves a Windows command wrapper in the
// process tree, and Playwright then waits indefinitely for it to exit when
// tearing down webServer. Starting the installed Next CLI with Node directly
// gives it one process it can actually stop, on every platform.
const nextCli = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const PORT = 3210;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Visual smoke gate — screenshots the dashboard/storefront pages that
 * previously shipped real contrast regressions (white-on-white console
 * cards, a dark-on-dark edit modal, a clipped metric grid — see git log
 * for the fixes) in both light and dark `prefers-color-scheme`, since OS
 * theme was the actual trigger for two of those. This is the cheap,
 * concrete backstop the platform didn't have before: a PR that reintroduces
 * one of those failure modes now fails a screenshot diff instead of
 * shipping to production first.
 *
 * Requires the app already built (`next build`) and a database that has
 * been migrated + seeded (`db:deploy && db:seed`) before this config's
 * webServer starts `next start` — see e2e/global-setup.ts and CI's
 * visual-smoke job for the exact order.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"]] : [["list"], ["html", { open: "never" }]],
  expect: {
    toHaveScreenshot: {
      // Small, deliberate tolerance for anti-aliasing/font-hinting noise
      // between local and CI rendering — not for hiding a real colour
      // regression, which moves far more than this per pixel.
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `"${process.execPath}" "${nextCli}" start -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
