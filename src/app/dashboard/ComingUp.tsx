import Link from "next/link";
import styles from "./dashboard.module.css";

interface UpcomingAppointment {
  id: string;
  startTime: Date;
  service: { name: string } | null;
}

function formatSlot(date: Date): string {
  return date.toLocaleString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Reuses the same list already fetched for the "upcoming appointments" stat
// card — this is that same data as a compact timeline instead of just a
// count, not a new query.
export default function ComingUp({ appointments }: { appointments: UpcomingAppointment[] }) {
  if (appointments.length === 0) return null;

  const next = appointments.slice(0, 5);

  return (
    <section className={styles.comingUp}>
      <h2 className={styles.attentionTitle}>Coming up</h2>
      <ul className={styles.comingUpList}>
        {next.map((appt) => (
          <li key={appt.id} className={styles.comingUpItem}>
            <span className={styles.comingUpTime}>{formatSlot(appt.startTime)}</span>
            <span className={styles.comingUpService}>{appt.service?.name ?? "Booking"}</span>
          </li>
        ))}
      </ul>
      <Link href="/dashboard/appointments" className={styles.comingUpLink}>
        See all bookings
      </Link>
    </section>
  );
}
