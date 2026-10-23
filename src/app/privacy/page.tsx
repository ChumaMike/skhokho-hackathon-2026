import type { Metadata } from "next";
import LegalDocument from "@/components/legal/LegalDocument";
import { LEGAL_DOCUMENTS } from "@/lib/legal/documents";
import privacyMarkdown from "@/lib/legal/generated/privacy-notice";

const meta = LEGAL_DOCUMENTS.privacy;

export const metadata: Metadata = {
  title: `${meta.title} — Skhokho`,
  description: "How Skhokho Laboratory (Skhokho Labs) and the businesses on Skhokho handle your personal information (POPIA section 18).",
};

/** The POPIA s18 Privacy Notice, rendered from the generated copy of docs/legal/privacy-notice.md. */
export default function PrivacyPage() {
  return <LegalDocument meta={meta} markdown={privacyMarkdown} />;
}
