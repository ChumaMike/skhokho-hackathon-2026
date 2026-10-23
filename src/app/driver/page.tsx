import { redirect } from "next/navigation";
import { requireDriverSession } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma/client";
import {
  applicationReadiness,
  DOCUMENT_LABELS,
  operatingEligibility,
  requiredDocuments,
} from "@/modules/skhokholetha/driver.service";
import { getDriverBalance, listDriverLedger, releaseDueEarnings } from "@/modules/skhokholetha/ledger.service";
import { formatCents, formatSAPhone } from "@/lib/utils";
import { acceptedCurrentLegal, driverLegalConfig } from "@/modules/skhokholetha/legal";
import DriverConsole from "./DriverConsole";
import DocumentUpload from "./DocumentUpload";
import { acceptAgreement, allowLocation, resendVerification, saveProfile, savePayout, saveVehicle, submitApplication } from "./actions";

export const dynamic = "force-dynamic";

const VEHICLES = [
  { value: "BICYCLE", label: "Bicycle" },
  { value: "SCOOTER", label: "Scooter" },
  { value: "MOTORCYCLE", label: "Motorbike" },
  { value: "CAR", label: "Car" },
  { value: "BAKKIE", label: "Bakkie" },
];

const OK_MESSAGES: Record<string, string> = {
  profile: "Your details are saved.",
  vehicle: "Vehicle saved.",
  payout: "Bank details saved.",
  agreement: "Thanks — your acceptance of the terms and privacy notice is recorded.",
  consent: "Thanks — location sharing is allowed while you're online.",
  submitted: "Application sent. We'll email you once it's checked.",
  "verify-sent": "We've sent a new confirmation link to your email.",
};

const LEDGER_LABELS: Record<string, string> = { DELIVERY_EARNING: "Delivery", ADJUSTMENT: "Adjustment", PAYOUT: "Payout" };

/** The driver's home: onboarding until approved, then the working console. */
export default async function DriverHomePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; verified?: string; verify?: string }> }) {
  let session;
  try {
    session = await requireDriverSession();
  } catch {
    redirect("/driver/login");
  }
  const sp = await searchParams;

  const d = await prisma.driverProfile.findUniqueOrThrow({
    where: { id: session.driverId },
    select: {
      displayName: true,
      phone: true,
      verificationStatus: true,
      availability: true,
      locationConsentAt: true,
      payoutBankName: true,
      payoutAccountLast4: true,
      payoutAccountCipher: true,
      agreementVersion: true,
      agreementAcceptedAt: true,
      privacyVersion: true,
      privacyAcceptedAt: true,
      reviewNote: true,
      suspensionReason: true,
      user: { select: { email: true, emailVerifiedAt: true } },
      vehicles: { where: { isActive: true }, select: { type: true, isActive: true, registration: true, makeModel: true } },
      documents: { orderBy: { uploadedAt: "desc" }, select: { id: true, kind: true, fileName: true, status: true, expiresOn: true, uploadedAt: true, reviewNote: true } },
    },
  });
  const vehicle = d.vehicles[0] ?? null;
  const status = d.verificationStatus;
  const banner = (
    <>
      {sp.ok && OK_MESSAGES[sp.ok] && <div className="successBanner">{OK_MESSAGES[sp.ok]}</div>}
      {sp.verified && <div className="successBanner">Email confirmed — thank you.</div>}
      {sp.verify === "expired" && <div className="errorBanner">That confirmation link has expired or was already used — send a new one below.</div>}
      {sp.verify === "limited" && <div className="errorBanner">Too many tries — wait a few minutes and try the link again.</div>}
      {sp.err && <div className="errorBanner">{sp.err}</div>}
    </>
  );
  const header = (
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <div>
        <span className="eyebrow">Skhokholetha</span>
        <h1 style={{ margin: 0 }}>Hi {d.displayName.split(" ")[0] || "there"}</h1>
      </div>
      <form method="post" action="/api/driver/logout">
        <button type="submit" className="btn">Log out</button>
      </form>
    </header>
  );

  if (status === "SUSPENDED") {
    return (
      <main className="shell"><div className="column">
        {header}
        <div className="card">
          <h2>Your driver account is on hold</h2>
          <p>You can&apos;t go online or take deliveries right now.{d.suspensionReason ? ` Reason: ${d.suspensionReason}` : ""}</p>
          <p>Questions? Reply to any Skhokho email and our team will help.</p>
        </div>
      </div></main>
    );
  }

  if (status === "PENDING_REVIEW") {
    return (
      <main className="shell"><div className="column">
        {header}
        {banner}
        <div className="card">
          <h2>We&apos;re checking your application</h2>
          <p>Our team is looking at your documents. This usually takes one to two working days — we&apos;ll email you at {d.user.email}.</p>
        </div>
      </div></main>
    );
  }

  if (status === "APPROVED") {
    const eligibility = operatingEligibility(d, d.vehicles, d.documents);
    await releaseDueEarnings(new Date(), session.driverId);
    const [balance, ledger] = await Promise.all([getDriverBalance(session.driverId), listDriverLedger(session.driverId, 20)]);
    return (
      <main className="shell"><div className="column">
        {header}
        {banner}
        {!acceptedCurrentLegal(d) && <LegalSection profile={d} />}
        {!d.locationConsentAt ? (
          <div className="card">
            <h2>Allow location sharing</h2>
            <p>
              While you&apos;re online we use your location to offer you nearby deliveries, and while you&apos;re on a delivery the
              customer sees roughly where you are. When you go offline we stop — we never track your home or off-duty trips.
            </p>
            <form action={allowLocation}><button type="submit" className="btn btnPrimary">Allow while I&apos;m online</button></form>
          </div>
        ) : !eligibility.eligible ? (
          <div className="card">
            <h2>You can&apos;t go online yet</h2>
            <ul>{eligibility.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        ) : (
          <DriverConsole initialAvailability={d.availability} />
        )}

        <section className="card" style={{ marginTop: 16 }} aria-label="Earnings">
          <h2>Earnings</h2>
          <p>
            Available: <strong>{formatCents(balance.availableCents)}</strong> · Pending (24h hold): {formatCents(balance.pendingCents)} · Being paid:{" "}
            {formatCents(balance.inPayoutCents)} · Paid so far: {formatCents(balance.paidCents)}
          </p>
          {ledger.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {ledger.map((e) => (
                <li key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span>{LEDGER_LABELS[e.type] ?? e.type} · {e.createdAt.toLocaleDateString("en-ZA")}</span>
                  <span>{formatCents(e.amountCents)} <small>({e.status.toLowerCase()})</small></span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div></main>
    );
  }

  // DRAFT or REJECTED — onboarding.
  const readiness = applicationReadiness(d, Boolean(d.user.emailVerifiedAt), d.vehicles, d.documents);
  const docKinds = requiredDocuments(vehicle?.type ?? null).map((k) => ({ value: k, label: DOCUMENT_LABELS[k] }));

  return (
    <main className="shell"><div className="column">
      {header}
      {banner}
      {status === "REJECTED" && (
        <div className="errorBanner">
          We couldn&apos;t approve your application yet.{d.reviewNote ? ` ${d.reviewNote}` : ""} Fix the items below and send it again.
        </div>
      )}

      <section className="card">
        <h2>Your application</h2>
        {readiness.ready ? <p>Everything&apos;s in. Send it to our team for checking.</p> : (
          <>
            <p>Still to do:</p>
            <ul>{readiness.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </>
        )}
        <form action={submitApplication}>
          <button type="submit" className="btn btnPrimary btnBlock" disabled={!readiness.ready}>Send my application</button>
        </form>
      </section>

      {!d.user.emailVerifiedAt && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Confirm your email</h2>
          <p>We sent a link to {d.user.email}. Didn&apos;t get it?</p>
          <form action={resendVerification}><button type="submit" className="btn">Send it again</button></form>
        </section>
      )}

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Your details</h2>
        <form action={saveProfile}>
          <div className="field">
            <label className="label" htmlFor="displayName">Full name (as on your ID)</label>
            <input className="input" id="displayName" name="displayName" defaultValue={d.displayName} required maxLength={120} />
          </div>
          <div className="field">
            <label className="label" htmlFor="phone">Cellphone</label>
            <input className="input" id="phone" name="phone" type="tel" inputMode="tel" defaultValue={d.phone ? formatSAPhone(d.phone) : ""} placeholder="082 123 4567" required />
          </div>
          <button type="submit" className="btn btnBlock">Save details</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Your vehicle</h2>
        <form action={saveVehicle}>
          <div className="field">
            <label className="label" htmlFor="type">Vehicle</label>
            <select className="input" id="type" name="type" defaultValue={vehicle?.type ?? "CAR"} required>
              {VEHICLES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="registration">Registration number (not needed for a bicycle)</label>
            <input className="input" id="registration" name="registration" defaultValue={vehicle?.registration ?? ""} maxLength={20} />
          </div>
          <div className="field">
            <label className="label" htmlFor="makeModel">Make and model (optional)</label>
            <input className="input" id="makeModel" name="makeModel" defaultValue={vehicle?.makeModel ?? ""} maxLength={80} placeholder="e.g. Toyota Corolla" />
          </div>
          <button type="submit" className="btn btnBlock">Save vehicle</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Documents</h2>
        <p>Only our review team can see these. They are never shown to shops or customers.</p>
        {d.documents.length > 0 && (
          <ul>
            {d.documents.map((doc) => (
              <li key={doc.id}>
                {DOCUMENT_LABELS[doc.kind]} — {doc.status === "ACCEPTED" ? "accepted" : doc.status === "REJECTED" ? `not accepted${doc.reviewNote ? `: ${doc.reviewNote}` : ""}` : "waiting for review"}
              </li>
            ))}
          </ul>
        )}
        <DocumentUpload kinds={docKinds} />
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Where we pay you</h2>
        {d.payoutAccountCipher && <p>Saved: {d.payoutBankName} account ending {d.payoutAccountLast4}. Enter new details to change it.</p>}
        <form action={savePayout} autoComplete="off">
          <div className="field">
            <label className="label" htmlFor="bankName">Bank</label>
            <input className="input" id="bankName" name="bankName" required maxLength={60} placeholder="e.g. Capitec" />
          </div>
          <div className="field">
            <label className="label" htmlFor="accountHolder">Account holder</label>
            <input className="input" id="accountHolder" name="accountHolder" required maxLength={120} />
          </div>
          <div className="field">
            <label className="label" htmlFor="branchCode">Branch code</label>
            <input className="input" id="branchCode" name="branchCode" inputMode="numeric" pattern="\d{6}" required />
          </div>
          <div className="field">
            <label className="label" htmlFor="accountNumber">Account number</label>
            <input className="input" id="accountNumber" name="accountNumber" inputMode="numeric" required />
          </div>
          <button type="submit" className="btn btnBlock">Save bank details</button>
        </form>
      </section>

      <LegalSection profile={d} />
    </div></main>
  );
}

/**
 * Terms and privacy notice: links to the CONFIGURED documents (published
 * outside this app). The form posts the versions shown, so a version that
 * changes mid-read is refused rather than silently accepted.
 */
function LegalSection({
  profile,
}: {
  profile: { agreementVersion: string | null; agreementAcceptedAt: Date | null; privacyVersion: string | null; privacyAcceptedAt: Date | null };
}) {
  const legal = driverLegalConfig();
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Driver terms and privacy</h2>
      {!legal.ok ? (
        <p>The Skhokholetha driver terms and privacy notice aren&apos;t published yet. You can finish the rest of your application in the meantime.</p>
      ) : acceptedCurrentLegal(profile, legal) ? (
        <p>
          You accepted the <a href={legal.terms.url} target="_blank" rel="noreferrer">driver terms</a> (version {legal.terms.version}) and the{" "}
          <a href={legal.privacy.url} target="_blank" rel="noreferrer">privacy notice</a> (version {legal.privacy.version}).
        </p>
      ) : (
        <form action={acceptAgreement}>
          <input type="hidden" name="termsVersion" value={legal.terms.version} />
          <input type="hidden" name="privacyVersion" value={legal.privacy.version} />
          <p>
            Please read the <a href={legal.terms.url} target="_blank" rel="noreferrer">driver terms</a> (version {legal.terms.version}) and the{" "}
            <a href={legal.privacy.url} target="_blank" rel="noreferrer">driver privacy notice</a> (version {legal.privacy.version}).
            {profile.agreementAcceptedAt && " These have been updated since you last accepted them."}
          </p>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" name="agree" required /> I have read and accept the driver terms and privacy notice
          </label>
          <button type="submit" className="btn btnBlock" style={{ marginTop: 8 }}>Accept</button>
        </form>
      )}
    </section>
  );
}
