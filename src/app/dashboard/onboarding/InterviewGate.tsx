import { prisma } from "@/lib/prisma/client";
import { getProfile, shouldOpenInterview } from "@/modules/onboarding/onboarding.service";
import BusinessInterview from "./BusinessInterview";

/**
 * Decides whether the onboarding interview appears on the dashboard, and in
 * which form. A Server Component so the decision — and the profile read it
 * needs — never reaches the client for a business that has already finished.
 *
 * Three outcomes:
 *   - no profile, or one in progress that hasn't been put off  → dialog opens
 *   - in progress but "remind me later" was tapped             → quiet card
 *   - completed                                                → nothing
 *
 * Rendered from the dashboard Home page only. It is deliberately not in a
 * layout: the interview belongs to arriving at Home after registering, not to
 * every console screen — being ambushed by it on /dashboard/orders while
 * trying to serve a customer is exactly the wrong moment.
 */
export default async function InterviewGate({ businessId }: { businessId: string }) {
  const [profile, business] = await Promise.all([
    getProfile(businessId),
    prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true, category: true },
    }),
  ]);

  if (!business) return null;
  if (profile?.status === "COMPLETED") return null;

  const auto = shouldOpenInterview(profile);
  // The only remaining case is skipped-for-now: offer the card, not a dialog.
  if (!auto && profile?.skippedAt == null) return null;

  return (
    <BusinessInterview
      mode={auto ? "auto" : "resume"}
      businessName={business.name}
      category={business.category}
      initialAnswers={profile?.answers ?? {}}
      initialStep={profile?.currentStep ?? 0}
      initialBrief={profile?.brief ?? null}
    />
  );
}
