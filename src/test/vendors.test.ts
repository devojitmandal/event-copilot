import { describe, expect, it } from "vitest";
import { compareQuotes, makeQuote, normaliseAmount, projectedSpend, quoteTotal } from "../lib/vendors.js";
import { buildPlan } from "../lib/templates.js";

const items = buildPlan("wedding", 270000, 150);
const venue = items.find((i) => i.id === "venue")!;
const catering = items.find((i) => i.id === "catering")!;

describe("vendor quotes", () => {
  it("rejects invalid quotes and trims names", () => {
    expect(makeQuote("venue", "   ", 5000)).toBeNull();
    expect(makeQuote("venue", "Hall", 0)).toBeNull();
    expect(makeQuote("venue", "Hall", NaN)).toBeNull();
    expect(makeQuote("venue", "   Grand   Hall ", 5000)?.vendor).toBe("Grand Hall");
  });

  it("multiplies per-guest quotes by guest count and respects pricingBasis overrides", () => {
    const q = makeQuote("catering", "Caterer", 600)!;
    expect(quoteTotal(q, catering, 150)).toBe(90000);
    expect(quoteTotal(q, catering, 200)).toBe(120000);

    // Flat package quote inside a per-head category stays fixed when guest count changes
    const flatCatering = makeQuote("catering", "Flat Caterer", 90000, { pricingBasis: "fixed" })!;
    expect(quoteTotal(flatCatering, catering, 150)).toBe(90000);
    expect(quoteTotal(flatCatering, catering, 200)).toBe(90000);
  });

  it("adds excluded GST into quoteTotal and projectedSpend", () => {
    const q = makeQuote("venue", "Royal Palace", 100000, { gst: "excluded", gstRatePct: 18 })!;
    expect(quoteTotal(q, venue, 150)).toBe(118000);
  });

  it("preserves exact total when converting total to per-guest and back (no ₹50 rounding drift)", () => {
    const norm = normaliseAmount("total", 100000, "per_head", 150);
    expect(norm.amount).not.toBeNull();
    const q = makeQuote("catering", "Precision Caterer", norm.amount!)!;
    expect(quoteTotal(q, catering, 150)).toBe(100000);
  });

  it("flags the lowest quote (including ties) and the difference from plan", () => {
    const a = makeQuote("venue", "A", 50000)!;
    const b = makeQuote("venue", "B", 90000)!;
    const rows = compareQuotes([a, b], venue, 150);
    expect(rows.find((r) => r.vendor === "A")!.best).toBe(true);
    expect(rows.find((r) => r.vendor === "B")!.diff).toBeGreaterThan(0);
    expect(rows.find((r) => r.vendor === "A")!.diff).toBeLessThan(0);

    // Tied lowest quotes both get best = true when another quote is higher
    const a2 = makeQuote("venue", "A2", 50000)!;
    const tiedRows = compareQuotes([a, a2, b], venue, 150);
    expect(tiedRows.find((r) => r.vendor === "A")!.best).toBe(true);
    expect(tiedRows.find((r) => r.vendor === "A2")!.best).toBe(true);
    expect(tiedRows.find((r) => r.vendor === "B")!.best).toBe(false);
  });

  it("does not flag a best quote when there is only one", () => {
    expect(compareQuotes([makeQuote("venue", "A", 50000)!], venue, 150)[0].best).toBe(false);
  });

  it("swaps booked quotes into the projected spend and filters by event mode", () => {
    const base = projectedSpend(items, [], 150);
    const weddingQuote = { ...makeQuote("venue", "A", 10000, { mode: "wedding" })!, booked: true };
    expect(projectedSpend(items, [weddingQuote], 150, "wedding")).toBeLessThan(base);
    expect(projectedSpend(items, [weddingQuote], 150, "birthday")).toBe(base);
    expect(projectedSpend(items, [{ ...weddingQuote, booked: false }], 150, "wedding")).toBe(base);
  });
});