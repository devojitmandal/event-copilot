import { generatePlan, type PlanResult } from "./plan";
import { requestSchema } from "./schema";

export const MAX_BODY_BYTES = 4096;
const RATE_LIMIT = 10;
const WINDOW_MS = 60_000;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 100;

const hits = new Map<string, number[]>();
const cache = new Map<string, { at: number; value: PlanResult }>();

export function resetState() { hits.clear(); cache.clear(); }

interface Env { GEMINI_API_KEY?: string; GEMINI_MODEL?: string }

export async function handlePlan(
  rawBody: string, ip: string, env: Env, fetchFn: typeof fetch = fetch, now = Date.now(),
): Promise<{ status: number; body: unknown }> {
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return { status: 413, body: { error: "Request too large" } };

  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return { status: 429, body: { error: "Too many requests. Try again in a minute." } };
  hits.set(ip, [...recent, now]);

  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch { return { status: 400, body: { error: "Invalid JSON" } }; }
  const check = requestSchema.safeParse(parsed);
  if (!check.success) return { status: 400, body: { error: "Invalid input", details: check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) } };

  const key = JSON.stringify(check.data);
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return { status: 200, body: hit.value };

  const result = await generatePlan(check.data, env.GEMINI_API_KEY, env.GEMINI_MODEL || "gemini-flash-lite-latest", fetchFn);
  if (result.source === "ai") {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: now, value: result });
  }
  return { status: 200, body: result };
}