import type { CostItem, Cut, Totals } from "./types";

export const itemCost = (item: CostItem, guests: number): number =>
  Math.round(item.basis === "per_head" ? item.amount * guests : item.amount);

export function computeTotals(
  items: CostItem[],
  guests: number,
  budget: number,
  reservePct: number,
): Totals {
  const reserve = Math.round((budget * reservePct) / 100);
  const available = budget - reserve;
  const planned = items.reduce((sum, i) => sum + itemCost(i, guests), 0);
  return { reserve, available, planned, remaining: available - planned };
}

/**
 * Deterministic cut: lowest priority first, never below each item's floor.
 * Gemini may suggest what to cut; this function guarantees the numbers.
 */
export function fitToBudget(
  items: CostItem[],
  guests: number,
  available: number,
): { items: CostItem[]; cuts: Cut[]; shortfall: number } {
  const next = items.map((i) => ({ ...i }));
  const cuts: Cut[] = [];
  let over = next.reduce((s, i) => s + itemCost(i, guests), 0) - available;

  for (const item of [...next].sort((a, b) => a.priority - b.priority)) {
    if (over <= 0) break;
    const current = itemCost(item, guests);
    const original = items.find((i) => i.id === item.id)!;
    const minimum = Math.round(itemCost(original, guests) * item.floor);
    const saved = Math.min(over, current - minimum);
    if (saved <= 0) continue;
    const scale = (current - saved) / current;
    item.amount = item.amount * scale;
    over -= saved;
    cuts.push({ id: item.id, label: item.label, saved });
  }
  return { items: next, cuts, shortfall: Math.max(0, over) };
}

export const applyBudgetCut = (budget: number, pct: number): number =>
  Math.round(budget * (1 - pct / 100));
