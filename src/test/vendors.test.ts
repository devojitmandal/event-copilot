import { describe, expect, it } from "vitest";
import {
  compareQuotes,
  makeQuote,
  normaliseAmount,
  projectedSpend,
  projectedSpendDetails,
  quoteTotal,
} from "../lib/vendors.js";
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

    const flatCatering = makeQuote("catering", "Flat Caterer", 90000, { pricingBasis: "fixed" })!;
    expect(quoteTotal(flatCatering, catering, 150)).toBe(90000);
    expect(quoteTotal(flatCatering, catering, 200)).toBe(90000);
  });

  it("never assumes 18% when GST is excluded but rate is unknown (null) or 0%", () => {
    expect(
      quoteTotal(
        makeQuote("venue", "Vendor", 100000, {
          gst: "excluded",
          gstRatePct: null,
        })!,
        venue,
        150,
      ),
    ).toBe(100000);

    expect(
      quoteTotal(
        makeQuote("venue", "Vendor", 100000, {
          gst: "excluded",
          gstRatePct: 0,
        })!,
        venue,
        150,
      ),
    ).toBe(100000);

    expect(
      quoteTotal(makeQuote("venue", "Vendor", 100000, { gst: "excluded", gstRatePct: 5 })!, venue, 150),
    ).toBe(105000);
    expect(
      quoteTotal(makeQuote("venue", "Vendor", 100000, { gst: "excluded", gstRatePct: 12 })!, venue, 150),
    ).toBe(112000);
    expect(
      quoteTotal(makeQuote("venue", "Vendor", 100000, { gst: "excluded", gstRatePct: 18 })!, venue, 150),
    ).toBe(118000);
  });

  it("prevents a quote with excluded unknown GST from falsely winning 'best' over a complete quote", () => {
    const incompleteTaxQuote = makeQuote("venue", "Untaxed Subtotal Vendor", 100000, {
      gst: "excluded",
      gstRatePct: null,
    })!;
    const completeTaxQuote = makeQuote("venue", "All-In Vendor", 110000, {
      gst: "included",
    })!;
    const rows = compareQuotes([incompleteTaxQuote, completeTaxQuote], venue, 150);
    const untaxedRow = rows.find((r) => r.vendor === "Untaxed Subtotal Vendor")!;
    const allInRow = rows.find((r) => r.vendor === "All-In Vendor")!;
    expect(untaxedRow.excludesUnknownGst).toBe(true);
    expect(untaxedRow.best).toBe(false);
    expect(allInRow.best).toBe(true);
  });

  it("reports uncertain GST items in projectedSpendDetails so the dashboard never understates risk", () => {
    const bookedUntaxed = {
      ...makeQuote("venue", "Hall A", 60000, { mode: "wedding", gst: "excluded", gstRatePct: null })!,
      booked: true,
    };
    const details = projectedSpendDetails(items, [bookedUntaxed], 150, "wedding");
    expect(details.excludedUnknownGstItems).toEqual(["Venue"]);
  });

  it("calculates per-guest base price plus fixed/per-guest mandatory charges accurately", () => {
    const q = makeQuote("catering", "Royal Feast", 650, {
      pricingBasis: "per_head",
      mandatoryCharges: [{ name: "Delivery & Setup", amount: 5000, pricing: "total" }],
    })!;
    expect(quoteTotal(q, catering, 150)).toBe(102500);

    const qMixed = makeQuote("catering", "Royal Feast", 650, {
      pricingBasis: "per_head",
      mandatoryCharges: [
        { name: "Delivery & Setup", amount: 5000, pricing: "total" },
        { name: "Service Staff", amount: 50, pricing: "per_guest" },
      ],
    })!;
    expect(quoteTotal(qMixed, catering, 150)).toBe(110000);
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

    const a2 = makeQuote("venue", "A2", 50000)!;
    const tiedRows = compareQuotes([a, a2, b], venue, 150);
    expect(tiedRows.find((r) => r.vendor === "A")!.best).toBe(true);
    expect(tiedRows.find((r) => r.vendor === "A2")!.best).toBe(true);
    expect(tiedRows.find((r) => r.vendor === "B")!.best).toBe(false);
  });

  it("does not flag a best quote when there is only one", () => {
    expect(compareQuotes([makeQuote("venue", "A", 50000)!], venue, 150)[0].best).toBe(false);
  });

  it("isolates quotes between event modes in compareQuotes and projectedSpend", () => {
    const base = projectedSpend(items, [], 150);
    const weddingQuote = { ...makeQuote("venue", "A", 10000, { mode: "wedding" })!, booked: true };
    expect(projectedSpend(items, [weddingQuote], 150, "wedding")).toBeLessThan(base);
    expect(projectedSpend(items, [weddingQuote], 150, "birthday")).toBe(base);
    expect(compareQuotes([weddingQuote], venue, 150, "birthday")).toHaveLength(0);
    expect(compareQuotes([weddingQuote], venue, 150, "wedding")).toHaveLength(1);
  });
});