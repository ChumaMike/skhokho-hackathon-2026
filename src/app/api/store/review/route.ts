import { NextRequest, NextResponse } from "next/server";
import { submitReview, ReviewIneligibleError } from "@/modules/reviews/review.service";
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Unauthenticated review submission — same shape as /api/store/order and
 * /api/store/book: a plain form POST, no session. See
 * src/app/review/[kind]/[id]/page.tsx for the form this receives.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const kind = (form.get("kind") ?? "").toString();
  const id = (form.get("id") ?? "").toString();
  const ratingRaw = (form.get("rating") ?? "").toString();
  const comment = (form.get("comment") ?? "").toString().trim() || undefined;

  const backTo = `/review/${kind}/${id}`;
  const back = (err: string) =>
    NextResponse.redirect(new URL(`${backTo}?err=${encodeURIComponent(err)}`, req.url), 303);

  if (kind !== "order" && kind !== "appointment") return back("That review link is invalid.");

  const limited = await checkRateLimits([["reviewIp", clientIp(req)]]);
  if (!limited.allowed) return back(RATE_LIMITED_MESSAGE);

  const rating = Number(ratingRaw);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return back("Pick a star rating first.");
  }

  try {
    await submitReview(
      kind === "order" ? { orderId: id, rating, comment } : { appointmentId: id, rating, comment },
    );
  } catch (e) {
    const message =
      e instanceof ReviewIneligibleError
        ? e.message
        : "Could not submit that review. Try again.";
    return back(message);
  }

  return NextResponse.redirect(new URL(backTo, req.url), 303);
}
