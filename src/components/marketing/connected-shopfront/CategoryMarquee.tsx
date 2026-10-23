import {
  Baby,
  Car,
  Gem,
  MoreHorizontal,
  PartyPopper,
  Scissors,
  ShoppingBag,
  Sparkles,
  Store,
  UtensilsCrossed,
  WashingMachine,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { BUSINESS_CATEGORIES } from "@/lib/business-categories";
import styles from "./connected-shopfront.module.css";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  SALON: Sparkles,
  FOOD_VENDOR: UtensilsCrossed,
  CAR_WASH: Car,
  RETAIL_STORE: ShoppingBag,
  TUCK_SHOP: Store,
  MECHANIC: Wrench,
  HAIR_BRAIDER: Scissors,
  NAIL_TECHNICIAN: Gem,
  EVENTS: PartyPopper,
  CHILDCARE: Baby,
  LAUNDRY: WashingMachine,
  OTHER: MoreHorizontal,
};

/**
 * A slow, continuous sliding strip of every real business category and
 * sub-type Skhokho actually supports (BUSINESS_CATEGORIES — the same list
 * /join's category picker uses, not an invented showcase list). Sits
 * between the proof strip and "Explore the platform" as a purely visual
 * beat — one honest fact ("this many kinds of business, one platform")
 * shown as motion rather than another paragraph.
 *
 * CSS-only marquee: the chip list is rendered twice back-to-back and the
 * track animates exactly -50% (one full copy's width), so the loop point
 * is invisible. `prefers-reduced-motion` is handled by the existing global
 * override in globals.css (`animation-duration: 0.001ms !important`) —
 * nothing extra needed here.
 */
export default function CategoryMarquee() {
  const chips = BUSINESS_CATEGORIES.map(([id, label]) => {
    const Icon = CATEGORY_ICONS[id] ?? MoreHorizontal;
    return (
      <span key={id} className={styles.marqueeChip}>
        <Icon size={15} /> {label}
      </span>
    );
  });

  return (
    <div className={styles.marqueeSection} aria-hidden="true">
      <div className={styles.marqueeTrack}>
        <div className={styles.marqueeGroup}>{chips}</div>
        <div className={styles.marqueeGroup}>{chips}</div>
      </div>
    </div>
  );
}
