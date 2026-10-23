import { Sparkles, ShoppingBag, Store, Wrench, type LucideIcon } from "lucide-react";

/**
 * One data source driving both the illustrated ConsoleMock/PhoneStorefront
 * mockups (ProductMockups.tsx) and the /for-businesses detail panel — so the
 * demo switcher's visual and its supporting copy are never two things that
 * can drift apart.
 *
 * `template` is a discriminated union tag: each vertical gets its own widget
 * shape (bar chart vs. week calendar vs. donut chart vs. jobs timeline; an
 * image-card grid vs. service rows vs. quantity steppers vs. package cards)
 * instead of one shape reskinned four ways, each still grounded in something
 * the real product genuinely does (see ProductMockups.tsx's own comment).
 *
 * Content sourcing, per vertical:
 * - Food ("Kasi Eats"): the original mockup content, unchanged.
 * - Salon ("Beauty by Nomsa"): real content from prisma/seed.ts's demo
 *   business — Soweto, Box Braids R350/180min, Manicure R80/45min — not
 *   invented. Hero tagline ("Look good. Feel like yourself.") and CTA
 *   language ("Book an appointment") match the salon-storefront.html
 *   concept mockup's own copy.
 * - Retail ("Zola's Corner Shop") and Services ("Thabo's Wash Bay") have no
 *   real seed-data equivalent, so their content is invented in the same
 *   register, sourced from category-classifier.ts's real keyword
 *   vocabulary for TUCK_SHOP and CAR_WASH respectively — never presented as
 *   real screenshots or real businesses (see ProductMockups.tsx's own
 *   comment).
 */

export interface DemoMetric {
  label: string;
  value: string;
}

export interface DemoRow {
  code: string;
  label: string;
  status: string;
  statusVariant: "new" | "ready";
}

export interface DemoItem {
  name: string;
  detail: string;
  price: string;
}

/** One appointment chip on the salon week-calendar grid. day/hour are indices into CALENDAR_DAYS/CALENDAR_HOURS. */
export interface CalendarSlot {
  day: number;
  hour: number;
  label: string;
  status: "new" | "confirmed";
}

export interface DemoService {
  name: string;
  duration: string;
  price: string;
}

/** One slice of the retail "what sells" donut chart. */
export interface DonutSlice {
  label: string;
  value: number;
  color: "amber" | "veld" | "oxide" | "dust";
}

export interface RestockLine {
  name: string;
  qty: string;
}

/** One job on the services "today's route" timeline. */
export interface TimelineJob {
  time: string;
  label: string;
  address: string;
  status: "next" | "later";
}

export interface DemoPackage {
  name: string;
  detail: string;
  price: string;
}

export const CALENDAR_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const CALENDAR_HOURS = ["9am", "11am", "1pm", "3pm"];

interface BaseDemo {
  key: "food" | "salon" | "retail" | "services";
  label: string;
  icon: LucideIcon;
  businessName: string;
  ownerFirstName: string;
  heroImage: string;
  heroTagline: string;
  navItems: string[];
  metrics: [DemoMetric, DemoMetric, DemoMetric];
  catalogLabel: string;
  ctaLabel: string;
  intro: string;
  points: string[];
}

export interface FoodDemo extends BaseDemo {
  template: "food";
  key: "food";
  chartBars: number[];
  rows: [DemoRow, DemoRow];
  tabs: string[];
  items: [DemoItem, DemoItem];
}

export interface SalonDemo extends BaseDemo {
  template: "salon";
  key: "salon";
  appointments: CalendarSlot[];
  services: [DemoService, DemoService];
}

export interface RetailDemo extends BaseDemo {
  template: "retail";
  key: "retail";
  sales: DonutSlice[];
  restock: [RestockLine, RestockLine];
  tabs: string[];
  stepperItems: [DemoItem, DemoItem];
}

export interface ServicesDemo extends BaseDemo {
  template: "services";
  key: "services";
  jobs: TimelineJob[];
  packages: [DemoPackage, DemoPackage];
}

export type VerticalDemo = FoodDemo | SalonDemo | RetailDemo | ServicesDemo;

export const VERTICAL_DEMOS: VerticalDemo[] = [
  {
    template: "food",
    key: "food",
    label: "Food & takeaway",
    icon: Store,
    businessName: "Kasi Eats",
    ownerFirstName: "Thandi",
    heroImage: "/connected-shopfront/business-food.svg",
    heroTagline: "Good food brings people together.",
    navItems: ["Home", "Orders", "Menu", "Customers", "Kitchen", "Storefront"],
    metrics: [
      { label: "Needs you", value: "2 orders" },
      { label: "Taken today", value: "R1,420" },
      { label: "Customers", value: "198" },
    ],
    chartBars: [42, 66, 52, 80, 61, 92, 73],
    rows: [
      { code: "#1042", label: "2 × Skhamani", status: "New", statusVariant: "new" },
      { code: "#1041", label: "Chips only", status: "Ready", statusVariant: "ready" },
    ],
    catalogLabel: "Menu",
    tabs: ["Popular", "Burgers", "Drinks"],
    items: [
      { name: "Kasi Smash", detail: "Beef, cheese, house sauce", price: "R89" },
      { name: "Peri-Peri Wings", detail: "6 wings, signature spice", price: "R75" },
    ],
    ctaLabel: "View basket · R164",
    intro:
      "Menus, orders, kitchen and delivery — connected from the moment a customer taps “order” to the moment it's in their hands.",
    points: [
      "A menu customers can browse and order from, with option groups for size, extras and sides",
      "A kitchen board that keeps orders moving — new, preparing, ready",
      "A counter workspace for walk-in and phone-in orders",
      "Delivery dispatch with driver assignment, plus a driver's own mobile view",
    ],
  },
  {
    template: "salon",
    key: "salon",
    label: "Salon & beauty",
    icon: Sparkles,
    businessName: "Beauty by Nomsa",
    ownerFirstName: "Nomsa",
    heroImage: "/connected-shopfront/business-salon.svg",
    heroTagline: "Look good. Feel like yourself.",
    navItems: ["Home", "Bookings", "Services", "Customers", "Storefront"],
    metrics: [
      { label: "Needs you", value: "3 bookings" },
      { label: "Taken today", value: "R610" },
      { label: "Customers", value: "142" },
    ],
    appointments: [
      { day: 1, hour: 2, label: "Box Braids", status: "confirmed" },
      { day: 2, hour: 0, label: "Manicure", status: "new" },
      { day: 4, hour: 1, label: "Braids · touch-up", status: "confirmed" },
    ],
    catalogLabel: "Services",
    services: [
      { name: "Box Braids", duration: "3 hr · precision parting", price: "R350" },
      { name: "Manicure", duration: "45 min · shape & polish", price: "R80" },
    ],
    ctaLabel: "Book an appointment",
    intro:
      "Services, bookings and the customers who keep coming back — the things a salon, barber or braider actually runs on.",
    points: [
      "Services with duration and price, ready for customers to book",
      "A bookings calendar instead of a scrap of paper behind the till",
      "Customer history and loyalty stamps for every visit",
      "Staff on their own logins, scoped to what they need",
    ],
  },
  {
    template: "retail",
    key: "retail",
    label: "Retail",
    icon: ShoppingBag,
    businessName: "Zola's Corner Shop",
    ownerFirstName: "Zola",
    heroImage: "/connected-shopfront/business-retail.svg",
    heroTagline: "Everything you need, just down the road.",
    navItems: ["Home", "Orders", "Products", "Customers", "Storefront"],
    metrics: [
      { label: "Needs you", value: "4 orders" },
      { label: "Taken today", value: "R860" },
      { label: "Customers", value: "231" },
    ],
    sales: [
      { label: "Snacks", value: 38, color: "amber" },
      { label: "Airtime", value: 27, color: "veld" },
      { label: "Cold drinks", value: 20, color: "oxide" },
      { label: "Other", value: 15, color: "dust" },
    ],
    restock: [
      { name: "Lucky Star Pilchards", qty: "6 left" },
      { name: "Airtime vouchers", qty: "12 left" },
    ],
    catalogLabel: "Products",
    tabs: ["Popular", "Snacks", "Airtime"],
    stepperItems: [
      { name: "Lucky Star Pilchards", detail: "400g tin", price: "R22" },
      { name: "Airtime voucher", detail: "R10 instant top-up", price: "R10" },
    ],
    ctaLabel: "View basket · R32",
    intro:
      "Products, orders and customers, set up for a shop or spaza counter — not a full e-commerce platform you don't need.",
    points: [
      "A product catalogue with photos and prices",
      "Orders for collection or delivery",
      "Customer loyalty — who's regular, who's worth checking in on",
      "One console for the counter and the back office",
    ],
  },
  {
    template: "services",
    key: "services",
    label: "Services",
    icon: Wrench,
    businessName: "Thabo's Wash Bay",
    ownerFirstName: "Thabo",
    heroImage: "/connected-shopfront/business-services.svg",
    heroTagline: "Your car, looked after properly.",
    navItems: ["Home", "Bookings", "Services", "Customers", "Storefront"],
    metrics: [
      { label: "Needs you", value: "2 bookings" },
      { label: "Taken today", value: "R740" },
      { label: "Customers", value: "96" },
    ],
    jobs: [
      { time: "08:30", label: "Full valet — sedan", address: "12 Vilakazi St", status: "next" },
      { time: "10:30", label: "Wash & vac — bakkie", address: "Corner Motors", status: "later" },
      { time: "13:00", label: "Full valet — pickup", address: "Church Square", status: "later" },
    ],
    catalogLabel: "Services",
    packages: [
      { name: "Full Valet", detail: "Wash, vacuum, tyre shine · 90 min", price: "R180" },
      { name: "Wash & Vac", detail: "Exterior + interior · 30 min", price: "R70" },
    ],
    ctaLabel: "Book a slot",
    intro:
      "Car washes, mechanics, event and other service businesses — bookings, clients and the day-to-day work in one place.",
    points: [
      "Bookings for jobs and appointments, not just a diary",
      "Customer history across every visit",
      "Staff and team logins scoped to their own work",
      "A storefront customers can book from directly",
    ],
  },
];
