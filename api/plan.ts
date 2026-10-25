import { handlePlan } from "../src/server/handler";

// Vercel serverless function. The Gemini key is read from the server environment only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    return res.end();
  }
  const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "unknown").split(",")[0].trim();
  const out = await handlePlan(raw, ip, process.env);
  res.statusCode = out.status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(out.body));
}