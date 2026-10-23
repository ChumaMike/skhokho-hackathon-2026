import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getBusinessBySlug } from "@/modules/tenant/tenant.service";
import { getCustomerSession } from "@/lib/auth/guards";
import { isPhoneMessagingConfigured } from "@/lib/messaging/provider";
import { safeReturnPath } from "@/lib/utils";
import CheckoutShell from "@/components/storefront/CheckoutShell";
import AccountLoginForm from "@/components/storefront/account/AccountLoginForm";
import { storefrontBasePath } from "@/lib/tenant/storefront-request";

export const dynamic = "force-dynamic";

interface Params {
  slug: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  // A sign-in page is never a search result.
  return { title: business ? `Sign in — ${business.name}` : "Business not found", robots: { index: false, follow: false } };
}

/**
 * Customer sign-in for THIS shop's storefront. The session it creates is
 * platform-wide (one cookie), but everything it unlocks is resolved per
 * business — see customer-account.service.ts.
 */
export default async function AccountLoginPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  const basePath = await storefrontBasePath(business.slug);
  const accountPath = `${basePath}/account`;
  const returnTo = safeReturnPath(sp.returnTo ?? "", accountPath);

  if (await getCustomerSession()) redirect(returnTo);

  return (
    <CheckoutShell business={business} basePath={basePath} pageTitle="Sign in">
      <AccountLoginForm businessId={business.id} businessName={business.name} phoneAvailable={isPhoneMessagingConfigured()} returnTo={returnTo} />
    </CheckoutShell>
  );
}
