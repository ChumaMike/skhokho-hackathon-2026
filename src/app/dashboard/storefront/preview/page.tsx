import { redirect } from "next/navigation";

/**
 * Consolidated onto the one real preview implementation at
 * /dashboard/preview (Storefront Console milestone §6/§27.A — this route
 * and /dashboard/preview used to render two independent copies of the same
 * StorefrontView call, exactly the kind of storefront-management
 * fragmentation this milestone exists to remove). Kept as a redirect
 * rather than deleted outright so the old link isn't a dead 404 for anyone
 * with it bookmarked or mid-navigation.
 */
export default function StorefrontPreviewRedirect() {
  redirect("/dashboard/preview");
}
