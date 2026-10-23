import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../session";
import { requireAnyStaffPermission } from "@/lib/auth/guards";
import { listAppointmentsInRange } from "@/modules/appointments/appointment.service";
import { listUnreviewedCompletedAppointments } from "@/modules/reviews/review.service";
import DashboardNav from "@/components/DashboardNav";
import ActionButton from "@/components/ActionButton";
import CopyLinkButton from "@/components/CopyLinkButton";
import { confirmAppointmentAction, markAppointmentComplete, cancelAppointmentAction } from "./actions";
import styles from "./appointments.module.css";

export const dynamic = "force-dynamic";

const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Requested",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
};

const CHIP_STATUS_CLASS: Record<string, string> = {
  CONFIRMED: styles.chipConfirmed,
  COMPLETED: styles.chipCompleted,
  CANCELLED: styles.chipCancelled,
  NO_SHOW: styles.chipNoShow,
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Week starts Monday — matches how a shop owner thinks about "this week",
// not the Date object's own Sunday-first getDay() numbering.
function mondayOf(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function formatWeekLabel(monday: Date, sunday: Date): string {
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const startStr = monday.toLocaleDateString("en-ZA", { day: "numeric", month: sameMonth ? undefined : "short" });
  const endStr = sunday.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
  return `${startStr} – ${endStr}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

function toParam(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; appt?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;

  let permitted = true;
  try {
    await requireAnyStaffPermission(["canReadBookings", "canManageBookings"]);
  } catch {
    permitted = false;
  }

  if (!permitted) {
    return (
      <main className="shell">
        <div className="column">
          <span className="eyebrow">Skhokho</span>
          <h1 className={styles.title}>Bookings</h1>
          <DashboardNav current="appointments" {...workspaceContext} />
          <div className={`card ${styles.empty}`}>
            <p>Your role doesn&apos;t have permission to view bookings — ask the business owner.</p>
          </div>
        </div>
      </main>
    );
  }

  const today = new Date();
  const requestedWeek = sp.week ? new Date(`${sp.week}T00:00:00`) : today;
  const monday = mondayOf(Number.isNaN(requestedWeek.getTime()) ? today : requestedWeek);
  const weekEnd = new Date(monday);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const sunday = new Date(weekEnd);
  sunday.setDate(sunday.getDate() - 1);

  const prevWeek = new Date(monday);
  prevWeek.setDate(prevWeek.getDate() - 7);
  const nextWeek = new Date(monday);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const [appointments, unreviewed] = await Promise.all([
    listAppointmentsInRange(session.tenantId, monday, weekEnd),
    listUnreviewedCompletedAppointments(session.tenantId),
  ]);

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + i);
    return {
      date,
      appointments: appointments.filter((a) => isSameDay(a.startTime, date)),
    };
  });

  const selected = appointments.find((a) => a.id === sp.appt) ?? appointments.find((a) => a.startTime >= today) ?? appointments[0] ?? null;

  const weekParam = toParam(monday);

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Bookings</h1>

        <DashboardNav current="appointments" {...workspaceContext} />

        {unreviewed.length > 0 && (
          <section className={styles.reviewSection}>
            <h2 className={styles.sectionTitle}>Ask for a review</h2>
            <p className={styles.sectionHint}>
              Share this link with the customer — WhatsApp is fine — so they can rate their visit.
            </p>
            <ul className={styles.reviewList}>
              {unreviewed.map((appt) => (
                <li key={appt.id} className={`card ${styles.reviewItem}`}>
                  <span className={styles.serviceName}>{appt.service?.name ?? "Booking"}</span>
                  <CopyLinkButton path={`/review/appointment/${appt.id}`} className={styles.completeBtn} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className={styles.calendarHeader}>
          <span className={styles.weekLabel}>{formatWeekLabel(monday, sunday)}</span>
          <div className={styles.weekNav}>
            <Link href={`/dashboard/appointments?week=${toParam(prevWeek)}`} className={styles.weekNavBtn} aria-label="Previous week">
              ←
            </Link>
            <Link href="/dashboard/appointments" className={styles.weekNavBtn}>
              Today
            </Link>
            <Link href={`/dashboard/appointments?week=${toParam(nextWeek)}`} className={styles.weekNavBtn} aria-label="Next week">
              →
            </Link>
          </div>
        </div>

        <div className={styles.layout}>
          <div className={styles.weekGrid}>
            {days.map((day) => (
              <div key={day.date.toISOString()} className={`${styles.dayColumn} ${isSameDay(day.date, today) ? styles.dayColumnToday : ""}`}>
                <div className={styles.dayHeader}>
                  {DAY_NAMES[day.date.getDay()]}
                  <b>{day.date.getDate()}</b>
                </div>
                {day.appointments.length === 0 ? (
                  <p className={styles.dayEmpty}>—</p>
                ) : (
                  day.appointments.map((appt) => (
                    <Link
                      key={appt.id}
                      href={`/dashboard/appointments?week=${weekParam}&appt=${appt.id}`}
                      className={`${styles.chip} ${CHIP_STATUS_CLASS[appt.status] ?? ""} ${selected?.id === appt.id ? styles.chipSelected : ""}`}
                    >
                      <b>{formatTime(appt.startTime)}</b>
                      {appt.service?.name ?? "Booking"}
                      <br />
                      <span>{appt.membership?.displayName ?? "Customer"}</span>
                    </Link>
                  ))
                )}
              </div>
            ))}
          </div>

          {selected ? (
            <aside className={`card ${styles.appointment} ${styles.detailPanel}`} aria-label="Selected booking">
              <div className={styles.top}>
                <span className={styles.serviceName}>{selected.service?.name ?? "Booking"}</span>
                <span className={styles.time}>{formatTime(selected.startTime)}</span>
              </div>
              <p className={styles.customer}>
                <span>
                  {selected.membership?.displayName || "Customer"}
                  {selected.membership?.shortCode ? ` · ${selected.membership.shortCode}` : ""}
                </span>
                <span className={`${styles.status} ${selected.status === "SCHEDULED" ? styles.statusScheduled : ""}`}>
                  {APPOINTMENT_STATUS_LABELS[selected.status] ?? selected.status}
                </span>
              </p>
              <div className={styles.actions}>
                {selected.status === "SCHEDULED" && (
                  <ActionButton action={confirmAppointmentAction.bind(null, selected.id)} className={styles.confirmBtn} pendingLabel="Confirming…">
                    Confirm
                  </ActionButton>
                )}
                {(selected.status === "SCHEDULED" || selected.status === "CONFIRMED") && (
                  <ActionButton action={markAppointmentComplete.bind(null, selected.id)} className={styles.completeBtn} pendingLabel="Completing…">
                    Mark complete
                  </ActionButton>
                )}
                {(selected.status === "SCHEDULED" || selected.status === "CONFIRMED") && (
                  <ActionButton action={cancelAppointmentAction.bind(null, selected.id)} className={styles.cancelBtn} pendingLabel="Cancelling…">
                    Cancel
                  </ActionButton>
                )}
              </div>
            </aside>
          ) : (
            <aside className={`card ${styles.emptyDetail}`}>
              <p>No bookings this week. Bookings from your storefront will show up here.</p>
            </aside>
          )}
        </div>
      </div>
    </main>
  );
}
