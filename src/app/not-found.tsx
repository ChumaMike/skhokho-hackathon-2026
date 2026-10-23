import NotFoundBody from "@/components/NotFoundBody";

// Next's special-file 404 boundary — this is what `notFound()` calls (e.g.
// store/[slug]/page.tsx) and genuinely unmatched routes actually render.
// Previously missing entirely: only the routed .../not-found/page.tsx
// existed, which is a different, middleware-rewrite-only mechanism (see
// components/NotFoundBody.tsx) that `notFound()` never reaches — every
// framework-level 404 was hitting Next's generic unstyled default instead
// of this app's branded page.
export default function NotFound() {
  return <NotFoundBody />;
}
