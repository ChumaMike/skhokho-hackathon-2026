"use client";

import { useState } from "react";
import { uploadTooLarge, uploadTooLargeMessage } from "@/lib/upload-limits";

/**
 * A file input that refuses an oversized image before the form is sent.
 * On a slow connection the alternative is minutes of upload followed by a
 * bare error page (the 2026-10-21 settings incident). The server still
 * checks; this just says so first, in a sentence, next to the field.
 */
export default function ImageFileInput({ id, name, accept = "image/jpeg,image/png,image/webp,image/gif", className = "input" }: { id: string; name: string; accept?: string; className?: string }) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <>
      <input
        className={className}
        id={id}
        name={name}
        type="file"
        accept={accept}
        aria-describedby={problem ? `${id}-problem` : undefined}
        aria-invalid={problem ? true : undefined}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && uploadTooLarge(file.size)) {
            setProblem(uploadTooLargeMessage(file.size));
            e.target.value = "";
          } else {
            setProblem(null);
          }
        }}
      />
      {problem && (
        <p id={`${id}-problem`} role="alert" style={{ margin: "6px 0 0", fontSize: "0.9rem", color: "var(--oxide)" }}>
          {problem}
        </p>
      )}
    </>
  );
}
