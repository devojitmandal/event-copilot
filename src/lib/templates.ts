import type { CostItem, EventMode } from "./types.js";

interface Row { id: string; label: string; basis: CostItem["basis"]; weight: number; priority: number; floor: number }

const TEMPLATES: Record<EventMode, Row[]> = {
  wedding: [
    { id: "venue", label: "Venue", basis: "fixed", weight: 25, priority: 4, floor: 0.7 },
    { id: "catering", label: "Catering", basis: "per_head", weight: 35, priority: 5, floor: 0.75 },
    { id: "decor", label: "Decor", basis: "fixed", weight: 12, priority: 2, floor: 0.4 },
    { id: "photo", label: "Photography", basis: "fixed", weight: 10, priority: 3, floor: 0.6 },
    { id: "attire", label: "Clothing & makeup", basis: "fixed", weight: 8, priority: 3, floor: 0.5 },
    { id: "other", label: "Invitations, favors, misc", basis: "per_head", weight: 10, priority: 1, floor: 0.3 },
  ],
  birthday: [
    { id: "venue", label: "Venue", basis: "fixed", weight: 25, priority: 3, floor: 0.4 },
    { id: "food", label: "Food & cake", basis: "per_head", weight: 40, priority: 5, floor: 0.7 },
    { id: "decor", label: "Decor & theme", basis: "fixed", weight: 15, priority: 2, floor: 0.3 },
    { id: "fun", label: "Entertainment", basis: "fixed", weight: 12, priority: 3, floor: 0.4 },
    { id: "favors", label: "Return gifts", basis: "per_head", weight: 8, priority: 1, floor: 0.2 },
  ],
  community: [
    { id: "venue", label: "Venue & permissions", basis: "fixed", weight: 20, priority: 4, floor: 0.6 },
    { id: "food", label: "Food & water", basis: "per_head", weight: 35, priority: 5, floor: 0.7 },
    { id: "setup", label: "Sound, stage, lighting", basis: "fixed", weight: 20, priority: 3, floor: 0.5 },
    { id: "print", label: "Printing & signage", basis: "fixed", weight: 10, priority: 2, floor: 0.3 },
    { id: "volunteers", label: "Volunteer support", basis: "per_head", weight: 15, priority: 2, floor: 0.3 },
  ],
};

/** Splits the available budget by template weight. Per-head items scale with guests. */
export function buildPlan(mode: EventMode, available: number, guests: number): CostItem[] {
  const rows = TEMPLATES[mode];
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);
  return rows.map((r) => {
    const share = (available * r.weight) / totalWeight;
    return {
      id: r.id, label: r.label, basis: r.basis,
      amount: r.basis === "per_head" ? share / Math.max(1, guests) : share,
      priority: r.priority, floor: r.floor,
    };
  });
}
