import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleExtract, matchesMime, resetExtractState } from "../server/extract";
import { normaliseAmount } from "../lib/vendors";

const pdf = Buffer.from("%PDF-1.4 sample quotation content").toString("base64");
const cats = [{ id: "venue", label: "Venue" }, { id: "catering", label: "Catering" }];
const body = (o = {}) => JSON.stringify({ mimeType: "application/pdf", data: pdf, categories: cats, ...o });
const env = { GEMINI_API_KEY: "key" };
const draft = { vendor: "Grand Hall", categoryId: "venue", amount: 80000, pricing: "total",
  inclusions: ["Tables", "Lighting"], exclusions: ["Decor"], paymentTerms: "50% advance", confidence: "high" };
const fetchWith = (d: unknown) => vi.fn(async () => ({ ok: true, status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(d) }] } }] }) })) as unknown as typeof fetch;

beforeEach(resetExtractState);

describe("matchesMime", () => {
  it("accepts matching headers and rejects mismatches", () => {
    expect(matchesMime("application/pdf", pdf)).toBe(true);
    expect(matchesMime("image/png", pdf)).toBe(false);
    expect(matchesMime("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]).toString("base64"))).toBe(true);
  });
});

describe("handleExtract", () => {
  it("rejects invalid bodies, wrong types and oversized files", async () => {
    expect((await handleExtract("{", "1.1.1.1", env)).status).toBe(400);
    expect((await handleExtract(body({ mimeType: "text/html" }), "1.1.1.1", env)).status).toBe(400);
    expect((await handleExtract(body({ mimeType: "image/png" }), "1.1.1.1", env)).status).toBe(400);
    expect((await handleExtract(body({ data: "A".repeat(4_196_000) }), "1.1.1.1", env)).status).toBe(413);
  });
  it("returns a cleaned draft from valid AI output", async () => {
    const r = await handleExtract(body(), "2.2.2.2", env, fetchWith(draft));
    expect(r.status).toBe(200);
    expect((r.body as { draft: { vendor: string } }).draft.vendor).toBe("Grand Hall");
  });
  it("drops a category id that is not in the plan", async () => {
    const r = await handleExtract(body(), "3.3.3.3", env, fetchWith({ ...draft, categoryId: "hacked" }));
    expect((r.body as { draft: { categoryId: unknown } }).draft.categoryId).toBeNull();
  });
  it("returns 502 when the AI output is invalid or the call fails", async () => {
    expect((await handleExtract(body(), "4.4.4.4", env, fetchWith({ vendor: 5 }))).status).toBe(502);
    const down = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    expect((await handleExtract(body(), "4.4.4.5", env, down)).status).toBe(502);
  });
  it("returns 503 without a key and 429 after 5 requests a minute", async () => {
    expect((await handleExtract(body(), "5.5.5.5", {})).status).toBe(503);
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await handleExtract("{}", "6.6.6.6", env)).status;
    expect(last).toBe(429);
  });
});

describe("normaliseAmount", () => {
  it("converts between total and per-guest prices", () => {
    expect(normaliseAmount("total", 90000, "per_head", 150).amount).toBe(600);
    expect(normaliseAmount("per_guest", 600, "fixed", 150).amount).toBe(90000);
    expect(normaliseAmount("total", 50000, "fixed", 150).note).toBe("");
    expect(normaliseAmount("unknown", 50000, "fixed", 150).note).toMatch(/Check/);
    expect(normaliseAmount("total", null, "fixed", 150).amount).toBeNull();
  });
});