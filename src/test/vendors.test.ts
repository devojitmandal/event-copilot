import { compareQuotes, makeQuote, projectedSpend, quoteTotal } from "../lib/vendors.js";
import { buildPlan } from "../lib/templates.js";

const items = buildPlan("wedding", 270000, 150);
const venue = items.find((i) => i.id === "venue")!;
const catering = items.find((i) => i.id === "catering")!;

describe("vendor quotes", () => {
  it("rejects invalid quotes and trims names", () => {
    expect(makeQuote("venue", "   ", 5000)).toBeNull();
    expect(makeQuote("venue", "Hall", 0)).toBeNull();
    expect(makeQuote("venue", "Hall", NaN)).toBeNull();
    expect(makeQuote("venue", "  Grand   Hall ", 5000)?.vendor).toBe("Grand Hall");
  });
  it("multiplies per-guest quotes by guest count", () => {
    const q = makeQuote("catering", "Caterer", 600)!;
    expect(quoteTotal(q, catering, 150)).toBe(90000);
    expect(quoteTotal(q, catering, 200)).toBe(120000);
  });
  it("flags the lowest quote and the difference from plan", () => {
    const a = makeQuote("venue", "A", 50000)!;
    const b = makeQuote("venue", "B", 90000)!;
    const rows = compareQuotes([a, b], venue, 150);
    expect(rows.find((r) => r.vendor === "A")!.best).toBe(true);
    expect(rows.find((r) => r.vendor === "B")!.diff).toBeGreaterThan(0);
    expect(rows.find((r) => r.vendor === "A")!.diff).toBeLessThan(0);
  });
  it("does not flag a best quote when there is only one", () => {
    expect(compareQuotes([makeQuote("venue", "A", 50000)!], venue, 150)[0].best).toBe(false);
  });
  it("swaps booked quotes into the projected spend", () => {
    const base = projectedSpend(items, [], 150);
    const q = { ...makeQuote("venue", "A", 10000)!, booked: true };
    expect(projectedSpend(items, [q], 150)).toBeLessThan(base);
    expect(projectedSpend(items, [{ ...q, booked: false }], 150)).toBe(base);
  });
});