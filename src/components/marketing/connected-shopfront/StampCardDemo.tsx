"use client";

import { useState, type CSSProperties } from "react";
import { stampTransform } from "@/app/dashboard/customers/stamp-seed";
import styles from "./StampCardDemo.module.css";

const DEMO_PUBLIC_ID = "demo-card";
const REQUIRED = 8;

/**
 * A tap-to-stamp demo of the product's signature element (docs/DESIGN.md's
 * loyalty card). Reuses the real `stampTransform` rotation math (a pure
 * function, no server dependency) so the disc placement looks identical to
 * the production StampCard — but this is a new, local-state-only
 * component, not the real one: it never imports StampCard itself, since
 * that component calls live `stampMember`/`redeemMember` server actions.
 * Nothing here reaches the network.
 */
export default function StampCardDemo() {
  const [progress, setProgress] = useState(3);
  const rewardReady = progress >= REQUIRED;

  return (
    <div className={styles.wrap}>
      <article className={`${styles.card} ${rewardReady ? styles.ready : ""}`}>
        <header className={styles.header}>
          <span className={styles.name}>Demo customer</span>
          <span className={styles.headerMeta}>
            <span className={styles.progress}>{progress} of {REQUIRED}</span>
            <span className={styles.code}>SK-4821</span>
          </span>
        </header>

        <div className={styles.slots}>
          {Array.from({ length: REQUIRED }, (_, i) => {
            if (i < progress) {
              const t = stampTransform(DEMO_PUBLIC_ID, i);
              const style = {
                "--rotate": `${t.rotate}deg`,
                "--ox": `${t.x}px`,
                "--oy": `${t.y}px`,
              } as CSSProperties;
              return <span key={i} className={styles.disc} style={style} />;
            }
            return (
              <button
                key={i}
                type="button"
                className={styles.slot}
                onClick={() => setProgress((p) => Math.min(REQUIRED, p + 1))}
                disabled={rewardReady}
                aria-label="Give a stamp"
              />
            );
          })}
        </div>

        {rewardReady ? (
          <>
            <div className={styles.readyBanner}>Reward ready</div>
            <button type="button" className={styles.rewardBtn} onClick={() => setProgress(0)}>
              Give the reward
            </button>
          </>
        ) : (
          <p className={styles.hint}>{REQUIRED - progress} more visit{REQUIRED - progress === 1 ? "" : "s"} to a reward</p>
        )}
      </article>
      <p className={styles.caption}>Try it — tap a slot. This is a demo card, not a real customer&apos;s.</p>
    </div>
  );
}
