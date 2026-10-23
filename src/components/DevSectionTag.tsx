import type { ReactNode } from "react";

/**
 * Dev-only labelled wrapper — a small corner tag naming the actual
 * component/location behind whatever's on screen, so feedback can say
 * "TrustBarSection" instead of "the bar with the four things in it."
 * Renders nothing in production (`NODE_ENV` is statically inlined at build
 * time, so the tag and its markup are dead-code-eliminated from the prod
 * bundle, not just hidden with CSS). Purely a positioning wrapper
 * otherwise — a bare `position: relative` div, block-level, no margin/
 * padding of its own — so it doesn't affect the real layout around it.
 */
export default function DevSection({ name, children }: { name: string; children: ReactNode }) {
  if (process.env.NODE_ENV === "production") return children;

  return (
    <div style={{ position: "relative" }}>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 2,
          left: 2,
          zIndex: 40,
          fontFamily: "monospace",
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1,
          color: "#001a08",
          background: "#4ade80",
          padding: "3px 7px",
          borderRadius: 4,
          pointerEvents: "none",
          letterSpacing: ".02em",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
      {children}
    </div>
  );
}
