import { itemCost } from "./budget.js";
import type { Basis, CostItem, EventMode } from "./types.js";

export interface OptionalAddOn {
  name: string;
  amount: number | null;
}

export type GstStatus = "included" | "excluded" | "unknown";

export interface Quote {
  id: string;
  itemId: string;
  vendor: string;
  amount: number;
  booked: boolean;
  mode?: EventMode;
  /** Optional override if the vendor priced this differently than the category's default basis */
  pricingBasis?: Basis;
  baseAmount?: number;
  mandatoryCharges?: number;
  gst?: GstStatus;
  gstRatePct?: number | null;
  optionalAddOns?: OptionalAddOn[];
  overtimeRates?: string[];
  inclusions?: string[];
  exclusions?: string[];
  paymentTerms?: string;
}

export interface QuoteRow extends Quote {
  total: number;
  diff: number;
  best: boolean;
}

/**
 * Computes the final rupee total for a quote.
 * - Uses `q.pricingBasis ?? item.basis` so per-guest quotes scale with guest count.
 * - If `q.gst === "excluded"`, adds `q.gstRatePct` (defaults to 18% if rate is omitted) on top.
 */
export const quoteTotal = (q: Quote, item: CostItem, guests: number): number => {
  const effectiveBasis = q.pricingBasis ?? item.basis;
  const subtotal = effectiveBasis === "per_head" ? q.amount * Math.max(1, guests) : q.amount;
  const gstMultiplier =
    q.gst === "excluded" ? 1 + (q.gstRatePct != null && q.gstRatePct > 0 ? q.gstRatePct : 18) / 100 : 1;
  return Math.round(subtotal * gstMultiplier);
};

export type QuoteExtra = Partial<
  Pick<
    Quote,
    | "mode"
    | "pricingBasis"
    | "baseAmount"
    | "mandatoryCharges"
    | "gst"
    | "gstRatePct"
    | "optionalAddOns"
    | "overtimeRates"
    | "inclusions"
    | "exclusions"
    | "paymentTerms"
  >
>;

export function makeQuote(
  itemId: string,
  vendor: string,
  amount: number,
  extra: QuoteExtra = {},
): Quote | null {
  const name = vendor.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name || !Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) return null;
  const id = `${itemId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return { id, itemId, vendor: name, amount, booked: false, ...extra };
}

/** diff > 0 means the quote is over the planned amount for that item. */
export function compareQuotes(quotes: Quote[], item: CostItem, guests: number, mode?: EventMode): QuoteRow[] {
  const planned = itemCost(item, guests);
  const rows = quotes
    .filter((q) => q.itemId === item.id && (!mode || !q.mode || q.mode === mode))
    .map((q) => {
      const total = quoteTotal(q, item, guests);
      return { ...q, total, diff: total - planned, best: false };
    });
  if (rows.length > 1) {
    const min = Math.min(...rows.map((r) => r.total));
    const max = Math.max(...rows.map((r) => r.total));
    // Highlight all tied lowest quotes, unless every single quote has the exact same price
    if (min < max) {
      for (const r of rows) {
        if (r.total === min) r.best = true;
      }
    } else {
      rows[0].best = true;
    }
  }
  return rows;
}

/** Planned total, but any item with a booked quote uses that quote instead. */
export function projectedSpend(items: CostItem[], quotes: Quote[], guests: number, mode?: EventMode): number {
  return items.reduce((sum, item) => {
    const booked = quotes.find((q) => q.itemId === item.id && q.booked && (!mode || !q.mode || q.mode === mode));
    return sum + (booked ? quoteTotal(booked, item, guests) : itemCost(item, guests));
  }, 0);
}

/**
 * Converts an extracted price to the unit the category uses (per guest or total).
 * Preserves floating-point precision when converting total -> per_head so
 * recalculating `quoteTotal` (which rounds the final rupee total) never drifts.
 */
export function normaliseAmount(
  pricing: "total" | "per_guest" | "unknown",
  amount: number | null,
  basis: Basis,
  guests: number,
): { amount: number | null; note: string } {
  if (amount == null || !Number.isFinite(amount)) {
    return { amount: null, note: "No price found. Enter it manually." };
  }
  const safeGuests = Math.max(1, Math.round(guests));
  if (pricing === "total" && basis === "per_head") {
    const exactPerGuest = Number((amount / safeGuests).toFixed(6));
    return {
      amount: exactPerGuest,
      note: `Converted the total to a per-guest price using ${safeGuests} guests.`,
    };
  }
  if (pricing === "per_guest" && basis === "fixed") {
    const exactTotal = Number((amount * safeGuests).toFixed(2));
    return {
      amount: exactTotal,
      note: `Converted the per-guest price to a total using ${safeGuests} guests.`,
    };
  }
  if (pricing === "unknown") {
    return { amount, note: "Could not tell if the price is a total or per guest. Check it." };
  }
  return { amount, note: "" };
}