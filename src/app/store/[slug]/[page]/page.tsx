import type { Metadata } from "next";
import { renderSitePage, sitePageMetadata } from "./render";

export const dynamic = "force-dynamic";

interface Params {
  slug: string;
  page: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug, page } = await params;
  return sitePageMetadata(slug, page);
}

/**
 * Owner-controlled pages that have no route of their own: policies
 * (/returns, /delivery, /your-privacy …), reviews, services and any custom
 * page. The built-in routes beside this folder (about, contact, gallery,
 * shop) take precedence in Next's router, and the page model's reserved
 * slug list keeps an owner from naming a page after any of them.
 */
export default async function StoreSitePage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ ok?: string; err?: string; collection?: string }> }) {
  const { slug, page } = await params;
  return renderSitePage(slug, page, await searchParams);
}
