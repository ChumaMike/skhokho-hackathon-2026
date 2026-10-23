import viewStyles from "@/components/StorefrontView.module.css";

/**
 * Extracted from StorefrontView's inline ABOUT renderer — same markup, now
 * reusable by the dedicated /about page. `body` (StorefrontContent.about.body
 * — a real, owner/AI-authored story) takes precedence when set; falling back
 * to the plain `description` column keeps every existing business rendering
 * exactly as it did before this richer field existed.
 */
export default function AboutSection({ description, body }: { description: string | null; body?: string }) {
  const text = body || description;
  if (!text) return null;
  return (
    <section className={viewStyles.section}>
      <h2 className={viewStyles.sectionTitle}>About</h2>
      <p className={viewStyles.description}>{text}</p>
    </section>
  );
}
