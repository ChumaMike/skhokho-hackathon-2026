import type { Metadata } from "next";
import LegalDocument from "@/components/legal/LegalDocument";
import { LEGAL_DOCUMENTS } from "@/lib/legal/documents";
import termsMarkdown from "@/lib/legal/generated/terms-of-service";

const meta = LEGAL_DOCUMENTS.terms;

export const metadata: Metadata = {
  title: `${meta.title} — Skhokho`,
  description: "The terms on which customers and businesses use Skhokho, run by Skhokho Laboratory (Skhokho Labs).",
};

/**
 * The platform Terms of Service, rendered from the generated copy of
 * docs/legal/terms-of-service.md (see scripts/legal/sync-legal-texts.mjs).
 * The version shown here is what checkout and booking record as accepted.
 * Until counsel signs the text off the page carries a visible draft badge;
 * flip `draft` in src/lib/legal/documents.ts when it is published.
 */
export default function TermsPage() {
  return <LegalDocument meta={meta} markdown={termsMarkdown} />;
}
