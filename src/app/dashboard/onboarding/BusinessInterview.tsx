"use client";

import { useMemo, useState, useTransition } from "react";
import { Dialog } from "@base-ui/react/dialog";
import type { BusinessCategory } from "@prisma/client";
import { QUESTIONS, suggestionsFor, type Answers } from "@/modules/onboarding/questions";
import { saveInterviewProgress, skipInterviewAction, completeInterviewAction } from "./actions";
import styles from "./BusinessInterview.module.css";

/**
 * The onboarding interview dialog.
 *
 * Opens by itself the first time an owner lands on the dashboard after
 * registering. Everything about it is shaped by who is answering: someone on
 * an Android phone, standing in their shop, who has just signed up and owes
 * us nothing. So —
 *
 *  - one question per screen, never a wall of fields
 *  - the options are tappable chips written the way shop owners talk, and the
 *    first question's chips come from their business category, so the common
 *    path is literally two taps and Next
 *  - typing is always optional and always last
 *  - every step autosaves, and "Remind me later" is offered from step one, so
 *    closing the dialog can never lose work or feel like a trap
 *
 * Answers are stored as string[] throughout, including single-select, so a
 * free-text note is just one more entry and the brief reads naturally either
 * way.
 */

const TOTAL_QUESTIONS = QUESTIONS.length;

interface BusinessInterviewProps {
  businessName: string;
  category: BusinessCategory;
  initialAnswers: Answers;
  initialStep: number;
  /** A finished brief, when the owner is re-opening to review it. */
  initialBrief?: string | null;
  /**
   * "auto" opens the dialog on arrival — the just-registered case. "resume"
   * renders a quiet card instead and only opens on tap, which is what an
   * owner who already said "remind me later" gets. Asking once with a dialog
   * is helpful; asking every visit with one is nagging.
   */
  mode?: "auto" | "resume";
}

function asList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

export default function BusinessInterview({
  businessName,
  category,
  initialAnswers,
  initialStep,
  initialBrief = null,
  mode = "auto",
}: BusinessInterviewProps) {
  const [open, setOpen] = useState(mode === "auto");
  const [step, setStep] = useState(Math.min(initialStep, TOTAL_QUESTIONS - 1));
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [note, setNote] = useState("");
  const [brief, setBrief] = useState<string | null>(initialBrief);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const question = QUESTIONS[step];
  const options = useMemo(() => suggestionsFor(question.id, category), [question, category]);
  const selected = asList(answers[question.id]);

  // The note box and the chips write to the same answer, so what's already
  // saved as free text has to be told apart from what came from a chip —
  // otherwise re-entering a step would duplicate it into the chip row.
  const savedNote = selected.find((s) => !options.includes(s)) ?? "";

  function setSelection(next: string[]) {
    setAnswers((prev) => ({ ...prev, [question.id]: next }));
  }

  function toggle(option: string) {
    if (question.kind === "single") {
      setSelection([option, ...(savedNote ? [savedNote] : [])]);
      return;
    }
    setSelection(
      selected.includes(option) ? selected.filter((s) => s !== option) : [...selected, option],
    );
  }

  /** Folds the note box into the answer before leaving a step. */
  function commitNote(): Answers {
    const trimmed = note.trim();
    const chips = selected.filter((s) => options.includes(s));
    const next = trimmed ? [...chips, trimmed] : savedNote ? [...chips, savedNote] : chips;
    const merged = { ...answers, [question.id]: next };
    setAnswers(merged);
    return merged;
  }

  function goTo(nextStep: number, merged: Answers) {
    setStep(nextStep);
    setNote("");
    setError(null);
    // Autosave is deliberately not awaited: the owner moves to the next
    // question immediately, and a slow or failed save must never block them.
    // The final submit sends the whole answer set anyway, so a dropped
    // autosave costs resume-position, not data.
    void saveInterviewProgress(merged, nextStep);
  }

  function handleNext() {
    const merged = commitNote();
    if (step < TOTAL_QUESTIONS - 1) {
      goTo(step + 1, merged);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await completeInterviewAction(merged);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBrief(result.data.brief);
    });
  }

  function handleBack() {
    const merged = commitNote();
    goTo(Math.max(0, step - 1), merged);
  }

  function handleSkip() {
    const merged = commitNote();
    startTransition(async () => {
      await skipInterviewAction(merged, step);
      setOpen(false);
    });
  }

  const showingBrief = brief !== null;

  return (
    <>
      {mode === "resume" && !open && (
        <button type="button" className={styles.resumeCard} onClick={() => setOpen(true)}>
          <span className={styles.resumeTitle}>Finish setting up your storefront</span>
          <span className={styles.resumeBody}>
            {TOTAL_QUESTIONS} quick questions about {businessName} — mostly tapping. We use your
            answers to build your site.
          </span>
          <span className={styles.resumeCta}>Pick up where you left off →</span>
        </button>
      )}

      {/* disablePointerDismissal: the whole point is that this opens by
          itself, so a stray tap outside it shouldn't wipe the dialog off
          screen mid-answer. "Remind me later" is the deliberate way out. */}
      <Dialog.Root open={open} onOpenChange={setOpen} disablePointerDismissal>
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup className={styles.popup}>
            {showingBrief ? (
              <BriefPanel
                businessName={businessName}
                brief={brief}
                onDone={() => setOpen(false)}
                onEdit={() => {
                  setBrief(null);
                  setStep(0);
                }}
              />
            ) : (
              <>
                <header className={styles.header}>
                  <p className={styles.eyebrow}>
                    Question {step + 1} of {TOTAL_QUESTIONS}
                  </p>
                  <Dialog.Title className={styles.title}>{question.prompt}</Dialog.Title>
                  <p className={styles.why}>{question.why}</p>
                </header>

                <div
                  className={styles.progress}
                  role="progressbar"
                  aria-valuenow={step + 1}
                  aria-valuemin={1}
                  aria-valuemax={TOTAL_QUESTIONS}
                  aria-label="Interview progress"
                >
                  <span
                    className={styles.progressFill}
                    style={{ width: `${((step + 1) / TOTAL_QUESTIONS) * 100}%` }}
                  />
                </div>

                <div className={styles.chips}>
                  {options.map((option) => {
                    const on = selected.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => toggle(option)}
                        className={`${styles.chip} ${on ? styles.chipOn : ""}`}
                        aria-pressed={on}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>

                <label className={styles.noteLabel} htmlFor="interview-note">
                  {question.freeTextLabel}
                  <span className={styles.optional}>Optional</span>
                </label>
                <textarea
                  id="interview-note"
                  className={styles.note}
                  rows={2}
                  value={note || savedNote}
                  onChange={(e) => {
                    setNote(e.target.value);
                    // Keep the note out of the chip row while typing.
                    if (savedNote) setSelection(selected.filter((s) => options.includes(s)));
                  }}
                  placeholder={question.freeTextPlaceholder}
                />

                {error && <p className={styles.error}>{error}</p>}

                <footer className={styles.footer}>
                  <button
                    type="button"
                    onClick={handleSkip}
                    className={styles.ghost}
                    disabled={isPending}
                  >
                    Remind me later
                  </button>
                  <div className={styles.footerRight}>
                    {step > 0 && (
                      <button
                        type="button"
                        onClick={handleBack}
                        className={styles.secondary}
                        disabled={isPending}
                      >
                        Back
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleNext}
                      className={styles.primary}
                      disabled={isPending}
                    >
                      {isPending
                        ? "Working on it…"
                        : step === TOTAL_QUESTIONS - 1
                          ? "Build my profile"
                          : "Next"}
                    </button>
                  </div>
                </footer>
              </>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/**
 * What we understood, shown back before the dialog closes — the moment a
 * wrong answer is cheapest to fix, and the only real proof to the owner that
 * answering six questions bought them something.
 */
function BriefPanel({
  businessName,
  brief,
  onDone,
  onEdit,
}: {
  businessName: string;
  brief: string;
  onDone: () => void;
  onEdit: () => void;
}) {
  return (
    <>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Done — thank you</p>
        <Dialog.Title className={styles.title}>
          Here&apos;s what we understood about {businessName}
        </Dialog.Title>
        <p className={styles.why}>
          We&apos;ll use this to build your storefront. You can change it any time from Storefront
          settings.
        </p>
      </header>

      <div className={styles.brief}>
        {brief.split("\n").map((line, i) => (
          <p key={i} className={styles.briefLine}>
            {line}
          </p>
        ))}
      </div>

      <footer className={styles.footer}>
        <button type="button" onClick={onEdit} className={styles.ghost}>
          Change my answers
        </button>
        <div className={styles.footerRight}>
          <button type="button" onClick={onDone} className={styles.primary}>
            Looks right
          </button>
        </div>
      </footer>
    </>
  );
}
