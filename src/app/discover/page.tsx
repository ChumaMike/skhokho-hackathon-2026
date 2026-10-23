import Link from "next/link";
import type { BusinessCategory } from "@prisma/client";
import SiteHeader from "@/components/SiteHeader";
import { searchActiveBusinesses } from "@/modules/tenant/tenant.service";
import { getRatingSummaries } from "@/modules/reviews/review.service";
import { BUSINESS_CATEGORIES, categoryLabel } from "@/lib/business-categories";
import LocateButton from "./LocateButton";
import styles from "./discover.module.css";

export const dynamic = "force-dynamic";

interface DiscoverSearchParams {
  category?: string;
  lat?: string;
  lng?: string;
  radiusKm?: string;
}

/**
 * The customer-facing side of "browse and book": search/filter active
 * businesses, click into each one's own real storefront (see
 * src/components/StorefrontView.tsx) — not a summary card. platform_root
 * zone (src/middleware.ts), so it's reachable on the marketing domain
 * regardless of tenant routing.
 */
export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<DiscoverSearchParams>;
}) {
  const sp = await searchParams;

  const category = isBusinessCategory(sp.category) ? sp.category : undefined;
  const lat = sp.lat ? Number(sp.lat) : undefined;
  const lng = sp.lng ? Number(sp.lng) : undefined;
  const radiusKm = sp.radiusKm ? Number(sp.radiusKm) : undefined;
  const hasLocation = lat !== undefined && lng !== undefined && !Number.isNaN(lat) && !Number.isNaN(lng);

  const results = await searchActiveBusinesses({
    category,
    ...(hasLocation && radiusKm ? { near: { lat, lng }, radiusKm } : {}),
  });
  const ratings = await getRatingSummaries(results.map((b) => b.id));

  return (
    <main className="shell">
      <div className="column wide">
        <SiteHeader current="discover" />
        <h1 className={styles.title}>Find a business</h1>
        <p className={styles.sub}>
          Browse real businesses on Skhokho and go straight to their page —
          what they sell, what they offer, and how to reach them.
        </p>

        <form id="discover-filters" method="get" className={styles.filters}>
          <div className="field">
            <label className="label" htmlFor="category">
              Category
            </label>
            <select className="input" id="category" name="category" defaultValue={category ?? ""}>
              <option value="">All categories</option>
              {BUSINESS_CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <input type="hidden" name="lat" defaultValue={sp.lat ?? ""} />
          <input type="hidden" name="lng" defaultValue={sp.lng ?? ""} />
          <input type="hidden" name="radiusKm" defaultValue={sp.radiusKm ?? ""} />

          <LocateButton />
          <button type="submit" className="btn btnPrimary">
            Search
          </button>
        </form>

        {hasLocation && radiusKm ? (
          <p className={styles.count}>
            {results.length} {results.length === 1 ? "business" : "businesses"} within {radiusKm}km
          </p>
        ) : (
          <p className={styles.count}>
            {results.length} {results.length === 1 ? "business" : "businesses"}
          </p>
        )}

        {results.length === 0 ? (
          <div className={styles.empty}>
            <p>No businesses match yet. Try a different category.</p>
          </div>
        ) : (
          <ul className={styles.results}>
            {results.map((business) => (
              <li key={business.id}>
                <Link href={`/store/${business.slug}`} className={`card ${styles.result}`}>
                  <div className={styles.resultTop}>
                    <span className={styles.resultName}>{business.name}</span>
                    {"distanceKm" in business && business.distanceKm !== undefined && (
                      <span className={styles.resultDistance}>
                        {business.distanceKm < 1
                          ? `${Math.round(business.distanceKm * 1000)}m`
                          : `${business.distanceKm.toFixed(1)}km`}
                      </span>
                    )}
                  </div>
                  <p className={styles.resultMeta}>
                    {categoryLabel(business.category)}
                    {business.suburb ? ` · ${business.suburb}` : business.city ? ` · ${business.city}` : ""}
                  </p>
                  {ratings[business.id] && ratings[business.id].count > 0 && (
                    <p className={styles.resultRating}>
                      ★ {ratings[business.id].average.toFixed(1)}
                      <span className={styles.resultRatingCount}>
                        ({ratings[business.id].count})
                      </span>
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function isBusinessCategory(value: string | undefined): value is BusinessCategory {
  return !!value && BUSINESS_CATEGORIES.some(([id]) => id === value);
}
