import { notFound } from "next/navigation";
import { getReviewableOrder, getReviewableAppointment } from "@/modules/reviews/review.service";
import styles from "./review.module.css";

export const dynamic = "force-dynamic";

/**
 * Public, unauthenticated review submission — reached via a link the owner
 * shares (WhatsApp, in person) once an order/appointment is marked
 * complete (see the "Recently completed" section on the orders/
 * appointments dashboards). The id in the URL IS the access token, same
 * trust model as /store/pay/[orderId] — there is no customer login in
 * this app to gate the page behind instead.
 */
export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ err?: string }>;
}) {
  const { kind, id } = await params;
  const sp = await searchParams;
  if (kind !== "order" && kind !== "appointment") notFound();

  // Each branch keeps its own narrow type (Order-shape vs Appointment-shape)
  // rather than being merged into one union-typed variable, which is what
  // let TS lose the correlation between `kind` and the record's shape.
  let businessName: string;
  let itemLabel: string;
  let reason: string | null | undefined;

  if (kind === "order") {
    const { order, reason: r } = await getReviewableOrder(id);
    if (!order) notFound();
    businessName = order.business.name;
    itemLabel = order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ");
    reason = r;
  } else {
    const { appointment, reason: r } = await getReviewableAppointment(id);
    if (!appointment) notFound();
    businessName = appointment.business.name;
    itemLabel = appointment.service?.name ?? "your booking";
    reason = r;
  }

  return (
    <main className="shell">
      <div className="column" style={{ paddingTop: "10vh" }}>
        <span className="eyebrow">{businessName}</span>
        <h1 className={styles.title}>How was it?</h1>
        {itemLabel && <p className={styles.sub}>{itemLabel}</p>}

        {reason === "already_reviewed" ? (
          <div className="successBanner">
            You&apos;ve already reviewed this one — thanks for taking the time.
          </div>
        ) : reason === "not_completed" ? (
          <div className={styles.notice}>
            This isn&apos;t marked complete yet — check back once {businessName} has finished up.
          </div>
        ) : reason === "no_membership" ? (
          <div className={styles.notice}>This one can&apos;t be reviewed.</div>
        ) : (
          <>
            {sp.err && <div className="errorBanner">{sp.err}</div>}
            <form method="post" action="/api/store/review" className={styles.form}>
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="id" value={id} />

              <div className={styles.stars}>
                <input type="radio" id="r5" name="rating" value="5" required />
                <label htmlFor="r5" aria-label="5 stars">
                  ★
                </label>
                <input type="radio" id="r4" name="rating" value="4" />
                <label htmlFor="r4" aria-label="4 stars">
                  ★
                </label>
                <input type="radio" id="r3" name="rating" value="3" />
                <label htmlFor="r3" aria-label="3 stars">
                  ★
                </label>
                <input type="radio" id="r2" name="rating" value="2" />
                <label htmlFor="r2" aria-label="2 stars">
                  ★
                </label>
                <input type="radio" id="r1" name="rating" value="1" />
                <label htmlFor="r1" aria-label="1 star">
                  ★
                </label>
              </div>

              <div className="field">
                <label className="label" htmlFor="comment">
                  Say more (optional)
                </label>
                <textarea
                  className={`input ${styles.textarea}`}
                  id="comment"
                  name="comment"
                  maxLength={1000}
                  rows={4}
                  placeholder="What stood out?"
                />
              </div>

              <button type="submit" className="btn btnPrimary btnBlock">
                Submit review
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
