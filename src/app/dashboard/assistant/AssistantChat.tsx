"use client";

import { useState } from "react";
import styles from "./assistant.module.css";

interface Message {
  role: "user" | "assistant";
  text: string;
  source?: "rules" | "model";
}

const SUGGESTIONS = [
  "Who's lapsed?",
  "Who are my regulars?",
  "Orders this week?",
  "What's coming up?",
];

export default function AssistantChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || sending) return;

    setError(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setSending(true);

    try {
      const res = await fetch("/api/dashboard/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body?.error ?? "Could not reach the assistant. Try again.");
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: body.data.answer, source: body.data.source },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the assistant. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.chat}>
      {messages.length === 0 && (
        <div className={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.suggestionChip}
              onClick={() => send(s)}
              disabled={sending}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className={styles.messages}>
        {messages.map((m, i) => (
          <div
            key={i}
            className={`${styles.bubble} ${m.role === "user" ? styles.bubbleUser : styles.bubbleAssistant}`}
          >
            {m.text}
            {m.role === "assistant" && m.source === "rules" && (
              <span className={styles.previewTag}>Preview — rules-based, not a live model yet</span>
            )}
          </div>
        ))}
        {sending && <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>Thinking…</div>}
      </div>

      {error && <div className="errorBanner">{error}</div>}

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          maxLength={500}
          disabled={sending}
        />
        <button type="submit" className="btn btnPrimary" disabled={sending || !input.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
