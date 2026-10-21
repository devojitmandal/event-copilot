import { useMemo, useState } from "react";
import { applyBudgetCut, computeTotals, fitToBudget, itemCost } from "./lib/budget";
import { buildPlan } from "./lib/templates";
import type { EventMode } from "./lib/types";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

export default function App() {
  const [mode, setMode] = useState<EventMode>("wedding");
  const [budget, setBudget] = useState(300000);
  const [guests, setGuests] = useState(150);
  const [reserve, setReserve] = useState(10);
  const [cutPct, setCutPct] = useState(0);

  const view = useMemo(() => {
    const base = computeTotals([], guests, budget, reserve);
    const plan = buildPlan(mode, base.available, guests);
    const newBudget = applyBudgetCut(budget, cutPct);
    const target = computeTotals([], guests, newBudget, reserve).available;
    const fit = fitToBudget(plan, guests, target);
    return { plan: fit.items, cuts: fit.cuts, shortfall: fit.shortfall, newBudget,
      totals: computeTotals(fit.items, guests, newBudget, reserve) };
  }, [mode, budget, guests, reserve, cutPct]);

  return (
    <main>
      <h1>Event Copilot</h1>
      <p className="sub">Budget-first planning. Estimates only: enter real vendor quotes as you get them.</p>
      <div className="row">
        {(["wedding", "birthday", "community"] as const).map((m) => (
          <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m}</button>
        ))}
      </div>
      <div className="grid">
        <label>Budget (₹)<input type="number" min={10000} value={budget} onChange={(e) => setBudget(+e.target.value)} /></label>
        <label>Guests<input type="number" min={1} value={guests} onChange={(e) => setGuests(+e.target.value)} /></label>
        <label>Reserve ({reserve}%)<input type="range" min={0} max={20} value={reserve} onChange={(e) => setReserve(+e.target.value)} /></label>
        <label>Cut budget by {cutPct}%<input type="range" min={0} max={40} value={cutPct} onChange={(e) => setCutPct(+e.target.value)} /></label>
      </div>
      <table>
        <thead><tr><th>Item</th><th>Type</th><th>Planned</th></tr></thead>
        <tbody>
          {view.plan.map((i) => (
            <tr key={i.id}><td>{i.label}</td><td>{i.basis === "per_head" ? "per guest" : "fixed"}</td><td>{inr(itemCost(i, guests))}</td></tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={2}>Reserve</td><td>{inr(view.totals.reserve)}</td></tr>
          <tr><td colSpan={2}>Total planned</td><td>{inr(view.totals.planned)}</td></tr>
        </tfoot>
      </table>
      {view.cuts.length > 0 && (
        <p>Cuts made: {view.cuts.map((c) => `${c.label} (−${inr(c.saved)})`).join(", ")}</p>
      )}
      {view.shortfall > 0 && <p role="alert">Still {inr(view.shortfall)} over, even at each item's minimum. Reduce guests or raise the budget.</p>}
    </main>
  );
}
