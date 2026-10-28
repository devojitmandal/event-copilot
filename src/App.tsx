import { useMemo, useState, type ChangeEvent } from "react";
import { applyBudgetCut, computeTotals, fitToBudget, itemCost } from "./lib/budget";
import { buildPlan } from "./lib/templates";
import type { EventMode } from "./lib/types";
import type { PlanResult } from "./server/plan";
import { addDays, buildTimeline, isValidDate, localToday } from "./lib/timeline";
import { compareQuotes, makeQuote, normaliseAmount, projectedSpend, type Quote } from "./lib/vendors";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

interface Draft {
  itemId: string; vendor: string; amount: string; inclusions: string;
  exclusions: string; paymentTerms: string; note: string; confidence: string;
}
const ACCEPT = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const MAX_FILE = 3 * 1024 * 1024;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
}

export default function App() {
  const [mode, setMode] = useState<EventMode>("wedding");
  const [budget, setBudget] = useState(300000);
  const [guests, setGuests] = useState(150);
  const [reserve, setReserve] = useState(10);
  const [cutPct, setCutPct] = useState(0);
  const [city, setCity] = useState("");
  const [vibe, setVibe] = useState("");
  const [eventDate, setEventDate] = useState(() => addDays(localToday(), 120));
  const [done, setDone] = useState<Set<string>>(new Set());
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [qItem, setQItem] = useState("");
  const [qVendor, setQVendor] = useState("");
  const [qAmount, setQAmount] = useState("");
  const [qError, setQError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [xError, setXError] = useState("");
  const [ai, setAi] = useState<{ key: string; result: PlanResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const view = useMemo(() => {
    const base = computeTotals([], guests, budget, reserve);
    const plan = buildPlan(mode, base.available, guests);
    const newBudget = applyBudgetCut(budget, cutPct);
    const target = computeTotals([], guests, newBudget, reserve).available;
    const fit = fitToBudget(plan, guests, target);
    return { plan: fit.items, cuts: fit.cuts, shortfall: fit.shortfall, newBudget,
      totals: computeTotals(fit.items, guests, newBudget, reserve) };
  }, [mode, budget, guests, reserve, cutPct]);
  
  const today = localToday();
  const timeline = useMemo(
    () => (isValidDate(eventDate) ? buildTimeline(mode, eventDate, today, done) : []),
    [mode, eventDate, today, done],
  );
  const overdue = timeline.filter((t) => t.status === "overdue").length;
  function toggle(id: string) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const quoteItem = view.plan.find((i) => i.id === qItem) ?? view.plan[0];
  const projected = projectedSpend(view.plan, quotes, guests);
  const available = view.totals.available;

  function addQuote() {
    const q = makeQuote(quoteItem.id, qVendor, Number(qAmount));
    if (!q) { setQError("Enter a vendor name and an amount above 0."); return; }
    setQError(""); setQuotes((p) => [...p, q]); setQVendor(""); setQAmount("");
  }
  function setBooked(id: string) {
    setQuotes((prev) => {
      const target = prev.find((q) => q.id === id);
      if (!target) return prev;
      return prev.map((q) => (q.itemId !== target.itemId ? q : q.id === id ? { ...q, booked: !q.booked } : { ...q, booked: false }));
    });
  }
  const removeQuote = (id: string) => setQuotes((p) => p.filter((q) => q.id !== id));

  const draftItem = draft ? view.plan.find((i) => i.id === draft.itemId) ?? quoteItem : null;
  const upd = (k: keyof Draft, v: string) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const draftPlanned = draftItem ? itemCost(draftItem, guests) : 0;
  const draftTotal = draft && draftItem ? Math.round(Number(draft.amount || 0) * (draftItem.basis === "per_head" ? guests : 1)) : 0;
  const draftSuspicious = draftTotal > available;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setXError(""); setDraft(null);
    if (!ACCEPT.includes(file.type)) { setXError("Use a PDF, PNG, JPG or WebP file."); return; }
    if (file.size > MAX_FILE) { setXError("File is too large. Keep it under 3 MB."); return; }
    setExtracting(true);
    try {
      const data = await readBase64(file);
      const res = await fetch("/api/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mimeType: file.type, data, categories: view.plan.map((i) => ({ id: i.id, label: i.label })) }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? "The server had a problem. Please try again.");
      const d = out.draft;
      const item = view.plan.find((i) => i.id === d.categoryId) ?? quoteItem;
      const norm = normaliseAmount(d.pricing, d.amount, item.basis, guests);
      setDraft({
        itemId: item.id, vendor: d.vendor ?? "", amount: norm.amount ? String(norm.amount) : "",
        inclusions: d.inclusions.join("\n"), exclusions: d.exclusions.join("\n"),
        paymentTerms: d.paymentTerms ?? "", note: norm.note, confidence: d.confidence,
      });
    } catch (err) {
      setXError((err instanceof Error ? err.message : "Extraction failed.") + " You can enter the quote manually below.");
    } finally { setExtracting(false); }
  }

  function confirmDraft() {
    if (!draft) return;
    const lines = (s: string) => s.split("\n").map((x) => x.trim().slice(0, 120)).filter(Boolean).slice(0, 10);
    const q = makeQuote(draft.itemId, draft.vendor, Number(draft.amount), {
      inclusions: lines(draft.inclusions), exclusions: lines(draft.exclusions),
      paymentTerms: draft.paymentTerms.trim().slice(0, 300),
    });
    if (!q) { setXError("A vendor name and an amount above 0 are required."); return; }
    setQuotes((p) => [...p, q]); setDraft(null); setXError("");
  }
  
  const payload = { mode, budget: Math.round(budget), guests: Math.round(guests), reservePct: reserve, cutPct, city, vibe };
  const key = JSON.stringify(payload);

  async function generate() {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: key });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "The server had a problem. Please try again.");
      setAi({ key, result: data });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally { setLoading(false); }
  }

  const stale = ai && ai.key !== key;
  const reasons = new Map(ai?.result.plan.cutExplanations.map((c) => [c.id, c.reason]));

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
        <label>City<input maxLength={60} placeholder="e.g. Bengaluru" value={city} onChange={(e) => setCity(e.target.value)} /></label>
        <label>Vibe or notes<input maxLength={200} placeholder="e.g. simple, traditional, outdoor" value={vibe} onChange={(e) => setVibe(e.target.value)} /></label>
        <label>Event date<input type="date" min={today} value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></label>
      </div>
      <table>
        <thead><tr><th>Item</th><th>Type</th><th>Planned</th></tr></thead>
        <tbody>
          {view.plan.map((i) => (
            <tr key={i.id}><td>{i.label}{reasons.get(i.id) && !stale && <small>{reasons.get(i.id)}</small>}</td><td>{i.basis === "per_head" ? "per guest" : "fixed"}</td><td>{inr(itemCost(i, guests))}</td></tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={2}>Reserve</td><td>{inr(view.totals.reserve)}</td></tr>
          <tr><td colSpan={2}>Total planned (excl. reserve)</td><td>{inr(view.totals.planned)}</td></tr>
        </tfoot>
      </table>
      {view.cuts.length > 0 && (
        <p>Cuts made: {view.cuts.map((c) => `${c.label} (−${inr(c.saved)})`).join(", ")}</p>
      )}
      {view.shortfall > 0 && <p role="alert">Still {inr(view.shortfall)} over, even at each item's minimum. Reduce guests or raise the budget.</p>}
      <h2>Timeline</h2>
      {timeline.length === 0 ? (
        <p role="alert">Pick a valid event date.</p>
      ) : (
        <>
          {overdue > 0 && <p role="alert">{overdue} task(s) should already be done for this date. Move the date later or fast-track them.</p>}
          <ul className="tasks">
            {timeline.map((t) => (
              <li key={t.id}>
                <label className="task">
                  <input type="checkbox" checked={t.status === "done"} onChange={() => toggle(t.id)} />
                  <span>{t.title}</span>
                </label>
                <span className={`chip ${t.status}`}>
                  {t.status === "done" ? "done" : t.status === "overdue" ? `${-t.daysLeft}d overdue` : `due ${t.due}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
            <h2>Vendor quotes</h2>
            <div className="upload">
        <label>Upload a quotation (PDF, PNG, JPG or WebP, up to 3 MB)
          <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={onFile} disabled={extracting} />
        </label>
        {extracting && <p aria-live="polite">Reading the quotation…</p>}
        {xError && <p role="alert">{xError}</p>}
        {draft && draftItem && (
          <div className="draft">
            <h3>Review the extracted quote</h3>
            <p className="sub">AI confidence: {draft.confidence}. Check every field before saving. If you change the category, re-check the amount.{draft.note && ` ${draft.note}`}</p>
            <div className="grid">
              <label>Category
                <select value={draft.itemId} onChange={(e) => upd("itemId", e.target.value)}>
                  {view.plan.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
              </label>
              <label>Vendor<input maxLength={60} value={draft.vendor} onChange={(e) => upd("vendor", e.target.value)} /></label>
              <label>{draftItem.basis === "per_head" ? "Quote per guest (₹)" : "Quote total (₹)"}
                <input type="number" min={1} value={draft.amount} onChange={(e) => upd("amount", e.target.value)} />
              </label>
            </div>
            <p className="sub">Total for {guests} guests: <strong>{inr(draftTotal)}</strong> (plan: {inr(draftPlanned)}).</p>
            {draftSuspicious && <p role="alert">This is more than your whole available budget. Check whether the amount is per guest or the total.</p>}
            <label>Includes (one per line)<textarea rows={3} value={draft.inclusions} onChange={(e) => upd("inclusions", e.target.value)} /></label>
            <label>Excludes (one per line)<textarea rows={3} value={draft.exclusions} onChange={(e) => upd("exclusions", e.target.value)} /></label>
            <label>Payment terms<input maxLength={300} value={draft.paymentTerms} onChange={(e) => upd("paymentTerms", e.target.value)} /></label>
            <div className="row">
              <button onClick={confirmDraft}>Confirm and add quote</button>
              <button onClick={() => setDraft(null)}>Discard</button>
            </div>
          </div>
        )}
      </div>
      <div className="grid">
        <label>Category
          <select value={quoteItem.id} onChange={(e) => setQItem(e.target.value)}>
            {view.plan.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </label>
        <label>Vendor<input maxLength={60} value={qVendor} onChange={(e) => setQVendor(e.target.value)} /></label>
        <label>{quoteItem.basis === "per_head" ? "Quote per guest (₹)" : "Quote total (₹)"}
          <input type="number" min={1} value={qAmount} onChange={(e) => setQAmount(e.target.value)} />
        </label>
      </div>
      <div className="row"><button onClick={addQuote}>Add quote</button></div>
      {qError && <p role="alert">{qError}</p>}
      {view.plan.map((item) => {
        const rows = compareQuotes(quotes, item, guests);
        if (rows.length === 0) return null;
        return (
          <div key={item.id}>
            <h3>{item.label}<small>Planned {inr(itemCost(item, guests))}</small></h3>
            <table>
              <thead><tr><th>Vendor</th><th>Quote</th><th>Vs plan</th><th>Actions</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.vendor}{r.best && <span className="chip good">lowest</span>}{r.booked && <span className="chip due_soon">booked</span>}
                      {r.inclusions?.length ? <small>Includes: {r.inclusions.join(", ")}</small> : null}
                      {r.exclusions?.length ? <small>Excludes: {r.exclusions.join(", ")}</small> : null}
                      {r.paymentTerms ? <small>Payment: {r.paymentTerms}</small> : null}
                    </td>
                    <td>{inr(r.total)}</td>
                    <td>{r.diff > 0 ? `${inr(r.diff)} over` : `${inr(-r.diff)} under`}</td>
                    <td>
                      <button onClick={() => setBooked(r.id)}>{r.booked ? "Unbook" : "Book"}</button>{" "}
                      <button onClick={() => removeQuote(r.id)} aria-label={`Remove ${r.vendor}`}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <p>Projected spend with booked quotes: {inr(projected)} of {inr(available)} available ({projected <= available ? `${inr(available - projected)} left` : `${inr(projected - available)} over`}).</p>
      <div className="row">
        <button onClick={generate} disabled={loading}>{loading ? "Generating…" : "Generate AI plan"}</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {stale && <p className="sub">Inputs changed since this plan. Generate again to refresh it.</p>}
      {ai && (
        <section aria-live="polite">
          <p className="sub">{ai.result.source === "ai" ? "Written by Gemini. Numbers come from the budget engine." : `Template plan, not AI (${ai.result.reason}).`}</p>
          <p>{ai.result.plan.summary}</p>
          <h2>Ideas</h2>
          <ul>{ai.result.plan.ideas.map((i) => <li key={i.title}><strong>{i.title}</strong>: {i.description}</li>)}</ul>
          {ai.result.plan.risks.length > 0 && (<><h2>Risks</h2><ul>{ai.result.plan.risks.map((r) => <li key={r}>{r}</li>)}</ul></>)}
        </section>
      )}
    </main>
  );
}
