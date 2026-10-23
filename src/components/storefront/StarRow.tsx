import viewStyles from "@/components/StorefrontView.module.css";

/** ★★★★☆ — filled stars rounded to the nearest whole star. Extracted from StorefrontView so ReviewsSection can share it. */
export default function StarRow({ value }: { value: number }) {
  const filled = Math.round(value);
  return (
    <span className={viewStyles.starRow} aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (i < filled ? "★" : "☆")).join("")}
    </span>
  );
}
