import { Fragment } from "react";
import styles from "./connected-shopfront.module.css";
import templateStyles from "./vertical-templates.module.css";
import {
  VERTICAL_DEMOS,
  CALENDAR_DAYS,
  CALENDAR_HOURS,
  type VerticalDemo,
  type FoodDemo,
  type SalonDemo,
  type RetailDemo,
  type ServicesDemo,
  type DonutSlice,
} from "./vertical-demo-data";

const DEFAULT_DEMO = VERTICAL_DEMOS[0] as FoodDemo;

const DONUT_COLOR_VAR: Record<DonutSlice["color"], string> = {
  amber: "var(--amber)",
  veld: "var(--veld)",
  oxide: "var(--oxide)",
  dust: "var(--dust)",
};

const DONUT_SWATCH_CLASS: Record<DonutSlice["color"], string> = {
  amber: templateStyles.swatchAmber,
  veld: templateStyles.swatchVeld,
  oxide: templateStyles.swatchOxide,
  dust: templateStyles.swatchDust,
};

function donutGradient(sales: DonutSlice[]) {
  let cursor = 0;
  const stops = sales.map((slice) => {
    const start = cursor;
    cursor += slice.value;
    return `${DONUT_COLOR_VAR[slice.color]} ${start}% ${cursor}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

/**
 * HTML/CSS product illustrations — not real screenshots, not invented
 * capabilities. Shared between the homepage, /product and /for-businesses so
 * the same "proof" visuals appear consistently wherever they're used.
 *
 * Each vertical gets its own console/phone widget shape (see
 * vertical-demo-data.ts's `template` union) grounded in a real feature the
 * product has elsewhere: Food's bar chart + order rows (the original
 * mockup), Salon's week calendar grid (the real Bookings calendar) + service
 * rows, Retail's donut chart (the real Analytics donut) + quantity steppers,
 * Services' today's-jobs timeline (the real Driver route card) + package
 * cards. ConsoleMock/PhoneStorefront below are thin dispatchers that pick
 * the right shape for `demo.template` — callers that don't pass a demo keep
 * the original Food/"Kasi Eats" content unchanged.
 */
export function ConsoleMock({ demo = DEFAULT_DEMO }: { demo?: VerticalDemo }) {
  const label = `Illustration of the Skhokho merchant console for a ${demo.label.toLowerCase()} business`;
  switch (demo.template) {
    case "salon":
      return <SalonConsole demo={demo} label={label} />;
    case "retail":
      return <RetailConsole demo={demo} label={label} />;
    case "services":
      return <ServicesConsole demo={demo} label={label} />;
    default:
      return <FoodConsole demo={demo} label={label} />;
  }
}

export function PhoneStorefront({ demo = DEFAULT_DEMO }: { demo?: VerticalDemo }) {
  const label = `Illustration of a ${demo.label.toLowerCase()} storefront on a phone`;
  switch (demo.template) {
    case "salon":
      return <SalonPhone demo={demo} label={label} />;
    case "retail":
      return <RetailPhone demo={demo} label={label} />;
    case "services":
      return <ServicesPhone demo={demo} label={label} />;
    default:
      return <FoodPhone demo={demo} label={label} />;
  }
}

function ConsoleNav({ demo }: { demo: VerticalDemo }) {
  return (
    <aside className={styles.consoleNav}>
      <strong>{demo.businessName}</strong>
      {demo.navItems.map((item, index) => (
        <span key={item} className={index === 0 ? styles.consoleNavActive : undefined}>{item}</span>
      ))}
    </aside>
  );
}

function ConsoleMetrics({ demo }: { demo: VerticalDemo }) {
  return (
    <>
      <div className={styles.consoleTopline}><span>Good morning, {demo.ownerFirstName} 👋</span><small>Today</small></div>
      <div className={styles.metricGrid}>
        {demo.metrics.map((m) => (
          <div key={m.label}><small>{m.label}</small><b>{m.value}</b></div>
        ))}
      </div>
    </>
  );
}

function PhoneHero({ demo }: { demo: VerticalDemo }) {
  return (
    <div className={styles.phoneHero} style={{ backgroundImage: `linear-gradient(180deg, rgba(14,10,5,.15), rgba(14,10,5,.86)), url('${demo.heroImage}')` }}>
      <small>{demo.businessName.toUpperCase()}</small>
      <strong>{demo.heroTagline}</strong>
    </div>
  );
}

/* ---------- Food: bar chart + order rows (the original mockup) ---------- */

function FoodConsole({ demo, label }: { demo: FoodDemo; label: string }) {
  return (
    <div className={styles.consoleMock} aria-label={label}>
      <ConsoleNav demo={demo} />
      <div className={styles.consoleBody}>
        <ConsoleMetrics demo={demo} />
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}><span>Sales this week</span><small>7 days</small></div>
          <div className={styles.bars}>{demo.chartBars.map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}</div>
        </div>
        <div className={styles.orderRows}>
          {demo.rows.map((row) => (
            <div key={row.code}>
              <span>{row.code}</span>
              <b>{row.label}</b>
              <em className={row.statusVariant === "ready" ? styles.ready : undefined}>{row.status}</em>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FoodPhone({ demo, label }: { demo: FoodDemo; label: string }) {
  return (
    <div className={styles.phone} aria-label={label}>
      <div className={styles.phoneSpeaker} />
      <PhoneHero demo={demo} />
      <div className={styles.phoneTabs}>
        {demo.tabs.map((tab, index) => (
          <span key={tab} className={index === 0 ? styles.activePill : undefined}>{tab}</span>
        ))}
      </div>
      {demo.items.map((item, index) => (
        <div key={item.name} className={styles.menuLine}>
          <i className={index === 1 ? `${styles.foodThumb} ${styles.foodThumbAlt}` : styles.foodThumb} />
          <div><b>{item.name}</b><small>{item.detail}</small><strong>{item.price}</strong></div>
          <button aria-label={`Add ${item.name}`}>+</button>
        </div>
      ))}
      <div className={styles.phoneCta}>{demo.ctaLabel}</div>
    </div>
  );
}

/* ---------- Salon: week calendar grid + service rows ---------- */

function SalonConsole({ demo, label }: { demo: SalonDemo; label: string }) {
  return (
    <div className={styles.consoleMock} aria-label={label}>
      <ConsoleNav demo={demo} />
      <div className={styles.consoleBody}>
        <ConsoleMetrics demo={demo} />
        <div className={templateStyles.calendarCard}>
          <div className={templateStyles.calendarHeader}><span>This week</span><small>{demo.appointments.length} bookings</small></div>
          <div className={templateStyles.calendarGrid}>
            <span />
            {CALENDAR_DAYS.map((day) => <span key={day} className={templateStyles.calendarDayLabel}>{day}</span>)}
            {CALENDAR_HOURS.map((hour, hourIndex) => (
              <Fragment key={hour}>
                <span className={templateStyles.calendarHourLabel}>{hour}</span>
                {CALENDAR_DAYS.map((day, dayIndex) => {
                  const slot = demo.appointments.find((a) => a.day === dayIndex && a.hour === hourIndex);
                  return slot ? (
                    <span
                      key={`${day}-${hour}`}
                      className={`${templateStyles.calendarChip} ${slot.status === "new" ? templateStyles.calendarChipNew : ""}`}
                    >
                      {slot.label}
                    </span>
                  ) : (
                    <span key={`${day}-${hour}`} className={templateStyles.calendarCell} />
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SalonPhone({ demo, label }: { demo: SalonDemo; label: string }) {
  return (
    <div className={styles.phone} aria-label={label}>
      <div className={styles.phoneSpeaker} />
      <PhoneHero demo={demo} />
      <div className={styles.phoneTabs}><span className={styles.activePill}>{demo.catalogLabel}</span></div>
      {demo.services.map((service) => (
        <div key={service.name} className={templateStyles.serviceRow}>
          <span className={templateStyles.serviceDot} />
          <div><b>{service.name}</b><small>{service.duration}</small><strong>{service.price}</strong></div>
          <button className={templateStyles.bookBtn} type="button">Book</button>
        </div>
      ))}
      <div className={styles.phoneCta}>{demo.ctaLabel}</div>
    </div>
  );
}

/* ---------- Retail: donut chart + quantity steppers ---------- */

function RetailConsole({ demo, label }: { demo: RetailDemo; label: string }) {
  return (
    <div className={styles.consoleMock} aria-label={label}>
      <ConsoleNav demo={demo} />
      <div className={styles.consoleBody}>
        <ConsoleMetrics demo={demo} />
        <div className={templateStyles.donutCard}>
          <div className={templateStyles.donutChart} style={{ background: donutGradient(demo.sales) }} />
          <div className={templateStyles.donutLegend}>
            {demo.sales.map((slice) => (
              <span key={slice.label}><i className={`${templateStyles.donutSwatch} ${DONUT_SWATCH_CLASS[slice.color]}`} />{slice.label} · {slice.value}%</span>
            ))}
          </div>
        </div>
        <div className={templateStyles.restockRows}>
          {demo.restock.map((line) => (
            <div key={line.name}>
              <b>{line.name}</b>
              <span>{line.qty}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RetailPhone({ demo, label }: { demo: RetailDemo; label: string }) {
  return (
    <div className={styles.phone} aria-label={label}>
      <div className={styles.phoneSpeaker} />
      <PhoneHero demo={demo} />
      <div className={styles.phoneTabs}>
        {demo.tabs.map((tab, index) => (
          <span key={tab} className={index === 0 ? styles.activePill : undefined}>{tab}</span>
        ))}
      </div>
      {demo.stepperItems.map((item) => (
        <div key={item.name} className={templateStyles.stepperRow}>
          <div><b>{item.name}</b><small>{item.detail}</small><strong>{item.price}</strong></div>
          <div className={templateStyles.stepperControls}>
            <button aria-label={`Fewer ${item.name}`} type="button">–</button>
            <span className={templateStyles.stepperQty}>1</span>
            <button aria-label={`More ${item.name}`} type="button">+</button>
          </div>
        </div>
      ))}
      <div className={styles.phoneCta}>{demo.ctaLabel}</div>
    </div>
  );
}

/* ---------- Services: today's jobs timeline + package cards ---------- */

function ServicesConsole({ demo, label }: { demo: ServicesDemo; label: string }) {
  return (
    <div className={styles.consoleMock} aria-label={label}>
      <ConsoleNav demo={demo} />
      <div className={styles.consoleBody}>
        <ConsoleMetrics demo={demo} />
        <div className={templateStyles.timelineCard}>
          {demo.jobs.map((job) => (
            <div key={job.time} className={templateStyles.timelineJob}>
              <span className={templateStyles.timelineTime}>{job.time}</span>
              <div>
                <span className={templateStyles.timelineLabel}>{job.label}</span>
                <span className={templateStyles.timelineAddress}>{job.address}</span>
                {job.status === "next" && <span className={templateStyles.timelineNext}>Up next</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ServicesPhone({ demo, label }: { demo: ServicesDemo; label: string }) {
  return (
    <div className={styles.phone} aria-label={label}>
      <div className={styles.phoneSpeaker} />
      <PhoneHero demo={demo} />
      <div className={templateStyles.packageCards}>
        {demo.packages.map((pkg) => (
          <div key={pkg.name} className={templateStyles.packageCard}>
            <b>{pkg.name}</b>
            <small>{pkg.detail}</small>
            <strong>{pkg.price}</strong>
          </div>
        ))}
      </div>
      <div className={styles.phoneCta}>{demo.ctaLabel}</div>
    </div>
  );
}
