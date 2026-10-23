import type { ReactNode } from "react";

/** View-models only. Call your existing tenant-scoped services in Server Components. */
/** `critical` mirrors AttentionSeverity's third level (attention.ts). Without
 *  it, "3 deliveries failed" renders identically to "2 pending invites". */
export type Tone = "new" | "preparing" | "ready" | "complete" | "warning" | "critical" | "neutral";
export interface NavItem { label: string; href: string; active?: boolean; }
export interface NavGroup { title: string; items: NavItem[]; }
export interface ConsoleIdentity { businessName: string; categoryLabel?: string; ownerLabel?: string; status?: string; storefrontHref?: string; }
export interface Signal { label: string; value: string; detail?: string; tone?: Tone; }
export interface Priority { id: string; title: string; detail?: string; href: string; tone?: Tone; }
export interface OrderRow { id: string; number: string; customer: string; fulfilment: string; total: string; statusLabel: string; tone: Tone; placedAt?: string; items?: {label: string; quantity: number; options?: string[]; priceLabel?: string}[]; }
export interface OwnerHomeModel {
  eyebrow?: string; greeting: string; intro?: string; signals: Signal[]; priorities: Priority[];
  orders?: OrderRow[]; ordersHref?: string; storefrontHref?: string; storefrontEditorHref?: string;
  storefrontTitle?: string; storefrontDescription?: string; children?: ReactNode;
}
export interface StoreOffering { id: string; name: string; priceLabel: string; detail?: string; imageUrl?: string; href: string; actionLabel?: string; action?: ReactNode; category?: string; }
export interface StoreIdentity { name: string; categoryLabel: string; tagline: string; about?: string; coverUrl?: string; logoUrl?: string; location?: string; whatsappHref?: string; customerActionHref: string; customerActionLabel: string; }
/** `fulfilment` is optional because a privacy-shaped kitchen query may not
 *  select it — and a ticket must never display a guessed one. */
export interface KitchenTicket { id: string; number: string; ageLabel: string; items: {name: string; quantity: number; options?: string[]}[]; fulfilment?: string; note?: string; action?: ReactNode; }
export interface SetupStep { id: string; label: string; detail?: string; href: string; state: "complete" | "current" | "upcoming"; }
