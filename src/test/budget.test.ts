import { applyBudgetCut, computeTotals, fitToBudget, itemCost } from "../lib/budget.js";
import { buildPlan } from "../lib/templates.js";

const MODES = ["wedding", "birthday", "community"] as const;

describe("buildPlan", () => {
  it.each(MODES)("%s plan sums to the available budget", (mode) => {
    const items = buildPlan(mode, 270000, 150);
    const sum = items.reduce((s, i) => s + itemCost(i, 150), 0);
    expect(Math.abs(sum - 270000)).toBeLessThanOrEqual(items.length);
  });
});

describe("guest count", () => {
  it("raises only per-head costs", () => {
    const items = buildPlan("wedding", 270000, 150);
    const fixed = items.filter((i) => i.basis === "fixed");
    const before = fixed.map((i) => itemCost(i, 150));
    const after = fixed.map((i) => itemCost(i, 200));
    expect(after).toEqual(before);
    expect(computeTotals(items, 200, 300000, 10).planned).toBeGreaterThan(
      computeTotals(items, 150, 300000, 10).planned,
    );
  });
});

describe("fitToBudget", () => {
  it("cuts lowest priority first and removes the overrun", () => {
    const items = buildPlan("wedding", 270000, 150);
    const target = 230000;
    const { items: fitted, cuts, shortfall } = fitToBudget(items, 150, target);
    const total = fitted.reduce((s, i) => s + itemCost(i, 150), 0);
    expect(shortfall).toBe(0);
    expect(Math.abs(total - target)).toBeLessThanOrEqual(fitted.length);
    expect(cuts[0].id).toBe("other");
  });
  it("never cuts below an item's floor and reports shortfall", () => {
    const items = buildPlan("wedding", 270000, 150);
    const { items: fitted, shortfall } = fitToBudget(items, 150, 20000);
    expect(shortfall).toBeGreaterThan(0);
    fitted.forEach((f, i) =>
      expect(itemCost(f, 150)).toBeGreaterThanOrEqual(Math.floor(itemCost(items[i], 150) * items[i].floor) - 1),
    );
  });
  it("does nothing when already within budget", () => {
    const items = buildPlan("birthday", 50000, 30);
    expect(fitToBudget(items, 30, 60000).cuts).toHaveLength(0);
  });
});

describe("applyBudgetCut", () => {
  it("reduces by a percentage", () => expect(applyBudgetCut(300000, 20)).toBe(240000));
});
