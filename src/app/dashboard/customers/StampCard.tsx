"use client";

import { useState, useTransition, type CSSProperties } from "react";
import styles from "./StampCard.module.css";
import { stampTransform } from "./stamp-seed";
import { stampMember, redeemMember } from "./actions";

interface StampCardProps {
  publicId: string;
  shortCode: string;
  displayName: string | null;
  stamps: number;
  redeems: number;
  required: number;
  lastSeenLabel: string;
  lapsed: boolean;
}

export default function StampCard({
  publicId,
  shortCode,
  displayName,
  stamps,
  redeems,
  required,
  lastSeenLabel,
  lapsed,
}: StampCardProps) {
  const [isPending, startTransition] = useTransition();
  const [pendingSlot, setPendingSlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stamps accumulate forever; redeeming resets the *current* card, so the
  // discs shown are stamps earned since the last redeem — the same formula
  // the redeem_reward RPC itself uses (see prisma/sql/00_functions.sql).
  const progress = Math.min(
    required,
    Math.max(0, stamps - redeems * required),
  );
  const rewardReady = progress >= required;

  function handleStamp() {
    if (isPending || rewardReady) return;
    setError(null);
    setPendingSlot(progress);
    // One key per tap, generated before the request fires — see
    // actions.ts's stampMember for what this protects against (and, just
    // as importantly, what it doesn't: this isPending guard is still the
    // thing stopping a rapid double-click from firing twice in the first
    // place; the key only protects a single request from being double-
    // counted if it's retried).
    const idempotencyKey = crypto.randomUUID();
    startTransition(async () => {
      const result = await stampMember(publicId, idempotencyKey);
      if (!result.ok) setError(result.error);
      setPendingSlot(null);
    });
  }

  function handleRedeem() {
    if (isPending) return;
    setError(null);
    const idempotencyKey = crypto.randomUUID();
    startTransition(async () => {
      const result = await redeemMember(publicId, idempotencyKey);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <article className={`${styles.card} ${rewardReady ? styles.ready : ""}`}>
      <header className={styles.header}>
        <span className={styles.name}>{displayName || "Customer"}</span>
        <span className={styles.headerMeta}>
          <span className={styles.progress}>{progress} of {required}</span>
          <span className={`mono ${styles.code}`}>{shortCode}</span>
        </span>
      </header>

      <div className={styles.slots}>
        {Array.from({ length: required }, (_, i) => {
          if (i < progress) {
            const t = stampTransform(publicId, i);
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
              className={`${styles.slot} ${pendingSlot === i ? styles.slotPending : ""}`}
              onClick={handleStamp}
              disabled={isPending || rewardReady}
              aria-label="Give a stamp"
            />
          );
        })}
      </div>

      {rewardReady ? (
        <>
          <div className={styles.readyBanner}>Reward ready</div>
          <button
            type="button"
            className={styles.rewardBtn}
            onClick={handleRedeem}
            disabled={isPending}
          >
            Give the reward
          </button>
        </>
      ) : (
        <footer className={styles.footer}>
          {lapsed && (
            <span className={styles.lapsedTag}>
              Hasn&apos;t been in for a while
            </span>
          )}
          <span className={styles.lastSeen}>Last seen {lastSeenLabel}</span>
        </footer>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </article>
  );
}
