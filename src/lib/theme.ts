import { cookies } from "next/headers";

export type ThemePreference = "light" | "dark" | "system";

const COOKIE_NAME = "skhokho-theme";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Reads the merchant's saved appearance choice server-side, so the root
 * layout can stamp `data-theme` on `<html>` before first paint — this is
 * the only way to avoid a flash of the wrong theme in an app this
 * Server-Component-heavy; a client-only `useEffect` toggle would always
 * paint once in the default theme first. Not httpOnly: the value carries
 * no security weight and this keeps the door open for a client-side
 * toggle to read/write it too, without needing an extra API round trip.
 */
export async function getThemePreference(): Promise<ThemePreference> {
  const store = await cookies();
  const value = store.get(COOKIE_NAME)?.value;
  return value === "light" || value === "dark" ? value : "system";
}

export async function setThemePreference(theme: ThemePreference): Promise<void> {
  const store = await cookies();
  if (theme === "system") {
    store.delete(COOKIE_NAME);
    return;
  }
  store.set(COOKIE_NAME, theme, {
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
    sameSite: "lax",
  });
}
