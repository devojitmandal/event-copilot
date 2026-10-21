export type EventMode = "wedding" | "birthday" | "community";
export type Basis = "fixed" | "per_head";

export interface CostItem {
  id: string;
  label: string;
  basis: Basis;
  /** Fixed: total rupees. Per head: rupees per guest. */
  amount: number;
  /** 1 (cut first) to 5 (protect). */
  priority: number;
  /** Lowest fraction of the original amount this item may be cut to (0-1). */
  floor: number;
}

export interface Totals {
  reserve: number;
  available: number;
  planned: number;
  remaining: number;
}

export interface Cut {
  id: string;
  label: string;
  saved: number;
}
