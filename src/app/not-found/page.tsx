import { notFound } from "next/navigation";

// Real page at the literal path src/middleware.ts rewrites to for reserved
// subdomains, inactive businesses, unknown slugs and another tenant's paths
// — a rewrite target needs an actual matchable route, which Next's own
// not-found.tsx special file isn't. Calling notFound() here renders that
// same branded page (src/app/not-found.tsx → components/NotFoundBody.tsx)
// with a real 404 status, instead of a 200 that search engines and clients
// would treat as a live page.
export default function TenantNotFound() {
  notFound();
}
