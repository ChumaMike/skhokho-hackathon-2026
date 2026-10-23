"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { ConsoleMock, PhoneStorefront } from "./ProductMockups";
import { VERTICAL_DEMOS, type VerticalDemo } from "./vertical-demo-data";
import styles from "./vertical-demo-switcher.module.css";

/**
 * The interactive "show, don't tell" demo — real ARIA tabs (not clickable
 * divs), switching the illustrated ConsoleMock/PhoneStorefront mockups
 * between business verticals. `showDetails` additionally renders the
 * vertical's intro/points list under the mockup, synced to the same active
 * tab, so /for-businesses gets one piece of state driving both the visual
 * and the supporting copy instead of two separately-maintained lists.
 */
export default function VerticalDemoSwitcher({
  mode,
  demos = VERTICAL_DEMOS,
  showDetails = false,
}: {
  mode: "console" | "phone" | "both";
  demos?: VerticalDemo[];
  showDetails?: boolean;
}) {
  const [activeKey, setActiveKey] = useState(demos[0].key);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = demos.find((d) => d.key === activeKey) ?? demos[0];
  const activeIndex = demos.findIndex((d) => d.key === activeKey);

  function focusTab(nextIndex: number) {
    const wrapped = (nextIndex + demos.length) % demos.length;
    setActiveKey(demos[wrapped].key);
    tabRefs.current[wrapped]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusTab(activeIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusTab(activeIndex - 1);
    }
  }

  return (
    <div className={styles.switcher}>
      <div className={styles.tablist} role="tablist" aria-label="See the product for a different kind of business">
        {demos.map(({ key, label, icon: Icon }, index) => (
          <button
            key={key}
            ref={(el) => { tabRefs.current[index] = el; }}
            role="tab"
            type="button"
            id={`vertical-tab-${key}`}
            aria-selected={key === activeKey}
            aria-controls={`vertical-panel-${key}`}
            tabIndex={key === activeKey ? 0 : -1}
            className={`${styles.tab} ${key === activeKey ? styles.tabActive : ""}`}
            onClick={() => setActiveKey(key)}
            onKeyDown={handleKeyDown}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      <div
        key={activeKey}
        id={`vertical-panel-${activeKey}`}
        role="tabpanel"
        aria-labelledby={`vertical-tab-${activeKey}`}
        className={styles.panel}
      >
        <div className={`${styles.mockups} ${mode !== "both" ? styles.mockupsSingle : ""}`}>
          {(mode === "console" || mode === "both") && (
            <div className={styles.consoleSlot}><ConsoleMock demo={active} /></div>
          )}
          {(mode === "phone" || mode === "both") && (
            <div className={styles.phoneSlot}><PhoneStorefront demo={active} /></div>
          )}
        </div>

        {showDetails && (
          <div className={styles.details}>
            <p>{active.intro}</p>
            <ul>
              {active.points.map((point) => (
                <li key={point}><Check size={15} /> <span>{point}</span></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
