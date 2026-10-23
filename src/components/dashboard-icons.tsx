import { Home, Users, ShoppingBag, Calendar, Package, BarChart3, Settings, MessageCircle, UserCog, Truck, ChefHat, Store, Globe, CreditCard, Megaphone, Inbox } from "lucide-react";
import type { DashboardSection } from "./DashboardNav";

/**
 * Shared by DashboardNav.tsx (a Server Component) and BusinessConsoleNav.tsx
 * ("use client") — each imports this module itself rather than one passing
 * the icon components to the other as a prop. React Server Components can
 * only pass serializable data across the server→client boundary; a
 * component reference (a function) in props throws
 * "Functions cannot be passed directly to Client Components" at runtime —
 * TypeScript doesn't catch this, only exercising the actual page does.
 */
export const DASHBOARD_ICONS: Record<DashboardSection, typeof Home> = {
  home: Home,
  customers: Users,
  orders: ShoppingBag,
  kitchen: ChefHat,
  appointments: Calendar,
  leads: Inbox,
  catalog: Package,
  storefront: Store,
  payments: CreditCard,
  staff: UserCog,
  assistant: MessageCircle,
  analytics: BarChart3,
  settings: Settings,
  domains: Globe,
  deliveries: Truck,
  content: Megaphone,
};
