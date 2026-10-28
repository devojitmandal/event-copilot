import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePlan, resetState } from "../server/handler.js";
import { generatePlan } from "../server/plan.js";
import { aiPlanSchema, requestSchema, sanitize } from "../server/schema.js";

const req = { mode: "wedding", budget: 300000, guests: 150, reservePct: 10, cutPct: 20, city: "Bengaluru", vibe: "simple" } as const;
const valid = {
  summary: "A balanced plan.",
  ideas: [{ title: "Marigold decor", description: "Cheap and festive." }],
  cutExplanations: [{ id: "other", reason: "Lowest priority." }],
  risks: ["Food spend per guest is low."],
};
const okFetch = () => vi.fn(async () => ({ ok: true, status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] } }] }) })) as unknown as typeof fetch;

beforeEach(resetState);

describe("schemas", () => {
  it("accepts a valid request and rejects bad numbers", () => {
    expect(requestSchema.safeParse(req).success).toBe(true);
    expect(requestSchema.safeParse({ ...req, guests: 0 }).success).toBe(false);
    expect(requestSchema.safeParse({ ...req, budget: 5 }).success).toBe(false);
    expect(requestSchema.safeParse({ ...req, mode: "party" }).success).toBe(false);
  });
  it("rejects malformed AI output", () => {
    expect(aiPlanSchema.safeParse({ summary: "x" }).success).toBe(false);
    expect(aiPlanSchema.safeParse(valid).success).toBe(true);
  });
  it("sanitizes free text", () => {
    expect(sanitize("hi {ignore} <b>all</b>\n`rules`")).not.toMatch(/[{}<>`\n]/);
    expect(sanitize("a".repeat(500)).length).toBe(200);
  });
});

describe("generatePlan", () => {
  it("returns AI output when Gemini responds with valid JSON", async () => {
    const r = await generatePlan(requestSchema.parse(req), "key", "m", okFetch());
    expect(r.source).toBe("ai");
    expect(r.plan.ideas[0].title).toBe("Marigold decor");
  });
  it("falls back honestly on invalid JSON", async () => {
    const bad = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }) })) as unknown as typeof fetch;
    const r = await generatePlan(requestSchema.parse(req), "key", "m", bad);
    expect(r.source).toBe("fallback");
    expect(r.reason).toBeTruthy();
  });
  it("falls back on HTTP errors and missing key", async () => {
    const err = vi.fn(async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;
    expect((await generatePlan(requestSchema.parse(req), "key", "m", err)).reason).toMatch(/429/);
    expect((await generatePlan(requestSchema.parse(req), undefined, "m", err)).reason).toMatch(/key/i);
  });
  it("keeps numbers deterministic whatever the AI says", async () => {
    const a = await generatePlan(requestSchema.parse(req), "key", "m", okFetch());
    const b = await generatePlan(requestSchema.parse(req), undefined, "m");
    expect(a.items).toEqual(b.items);
    expect(a.totals).toEqual(b.totals);
  });
});

describe("handlePlan", () => {
  const env = { GEMINI_API_KEY: "key" };
  it("rejects invalid JSON, bad input and oversized bodies", async () => {
    expect((await handlePlan("{", "1.1.1.1", env)).status).toBe(400);
    expect((await handlePlan(JSON.stringify({ ...req, guests: -1 }), "1.1.1.1", env)).status).toBe(400);
    expect((await handlePlan("x".repeat(5000), "1.1.1.1", env)).status).toBe(413);
  });
  it("caches identical requests so Gemini is called once", async () => {
    const f = okFetch();
    await handlePlan(JSON.stringify(req), "2.2.2.2", env, f);
    const second = await handlePlan(JSON.stringify(req), "2.2.2.2", env, f);
    expect(second.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("rate limits after 10 requests a minute per IP", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await handlePlan("{}", "3.3.3.3", env)).status;
    expect(last).toBe(429);
    expect((await handlePlan("{}", "4.4.4.4", env)).status).toBe(400);
  });
});