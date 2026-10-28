import { itemCost } from "./budget.js";
import type { Basis, CostItem } from "./types.js";

export interface Quote {
    id: string; itemId: string; vendor: string; amount: number; booked: boolean;
    inclusions?: string[]; exclusions?: string[]; paymentTerms?: string;
  }
export interface QuoteRow extends Quote { total: number; diff: number; best: boolean }

/** Per-guest items (like catering) are quoted per guest, so the total scales with guest count. */
export const quoteTotal = (q: Quote, item: CostItem, guests: number): number =>
  Math.round(item.basis === "per_head" ? q.amount * guests : q.amount);

export function makeQuote(
    itemId: string, vendor: string, amount: number,
    extra: Partial<Pick<Quote, "inclusions" | "exclusions" | "paymentTerms">> = {},
  ): Quote | null {
  const name = vendor.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name || !Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) return null;
  const id = `${itemId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return { id, itemId, vendor: name, amount, booked: false, ...extra };
}

/** diff > 0 means the quote is over the planned amount for that item. */
export function compareQuotes(quotes: Quote[], item: CostItem, guests: number): QuoteRow[] {
  const planned = itemCost(item, guests);
  const rows = quotes
    .filter((q) => q.itemId === item.id)
    .map((q) => {
      const total = quoteTotal(q, item, guests);
      return { ...q, total, diff: total - planned, best: false };
    });
  if (rows.length > 1) {
    const min = Math.min(...rows.map((r) => r.total));
    rows.find((r) => r.total === min)!.best = true;
  }
  return rows;
}

/** Planned total, but any item with a booked quote uses that quote instead. */
export function projectedSpend(items: CostItem[], quotes: Quote[], guests: number): number {
  return items.reduce((sum, item) => {
    const booked = quotes.find((q) => q.itemId === item.id && q.booked);
    return sum + (booked ? quoteTotal(booked, item, guests) : itemCost(item, guests));
  }, 0);
}

/** Converts an extracted price to the unit the category uses (per guest or total). */
export function normaliseAmount(
    pricing: "total" | "per_guest" | "unknown", amount: number | null, basis: Basis, guests: number,
  ): { amount: number | null; note: string } {
    if (amount == null) return { amount: null, note: "No price found. Enter it manually." };
    if (pricing === "total" && basis === "per_head")
      return { amount: Math.round(amount / Math.max(1, guests)), note: `Converted the total to a per-guest price using ${guests} guests.` };
    if (pricing === "per_guest" && basis === "fixed")
      return { amount: Math.round(amount * guests), note: `Converted the per-guest price to a total using ${guests} guests.` };
    if (pricing === "unknown") return { amount, note: "Could not tell if the price is a total or per guest. Check it." };
    return { amount, note: "" };
  }