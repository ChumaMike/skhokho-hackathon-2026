"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./AssistantDock.module.css";

interface BuddyMessage {
  id: string;
  role: "owner" | "buddy";
  content: string;
  createdAt: string;
}

/**
 * Chat with the buddy from the dock. History is stored per person on the
 * server, so it comes back on any device and nobody else on the team sees it. Read-only: the buddy answers
 * questions and never changes the business on its own.
 */
export default function BuddyChat() {
  const [messages, setMessages] = useState<BuddyMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/buddy/messages", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.ok) setMessages(body.data.messages as BuddyMessage[]);
        else {
          setMessages([]);
          setError("Couldn't load your chat. Try again in a moment.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([]);
          setError("Couldn't load your chat. Try again in a moment.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const question = draft.trim();
    if (!question || sending) return;
    setSending(true);
    setError(null);
    setDraft("");
    setMessages((prev) => [
      ...(prev ?? []),
      { id: `pending-${Date.now()}`, role: "owner", content: question, createdAt: new Date().toISOString() },
    ]);
    try {
      const res = await fetch("/api/dashboard/buddy/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const body = await res.json();
      if (!body?.ok) throw new Error(body?.error ?? "Something went wrong.");
      setMessages((prev) => [...(prev ?? []), body.data.message as BuddyMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.chat}>
      <div className={styles.thread}>
        {messages === null && <p className={styles.muted}>Loading your chat…</p>}
        {messages && messages.length === 0 && (
          <p className={styles.muted}>Ask about your regulars, lapsed customers, orders or bookings — or say &ldquo;write a post for my kota special&rdquo;.</p>
        )}
        {messages?.map((m) => (
          <div key={m.id} className={m.role === "owner" ? styles.bubbleOwner : styles.bubbleBuddy}>
            {m.content}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <form className={styles.composer} onSubmit={send}>
        <input
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={500}
          placeholder="Ask Skhokho…"
          aria-label="Ask Skhokho"
          disabled={sending}
        />
        <button type="submit" className={styles.send} disabled={sending || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
