import { z } from "zod";

export const requestSchema = z.object({
  mode: z.enum(["wedding", "birthday", "community"]),
  budget: z.number().int().min(10000).max(100_000_000),
  guests: z.number().int().min(1).max(5000),
  reservePct: z.number().min(0).max(20),
  cutPct: z.number().min(0).max(40),
  city: z.string().max(60).optional().default(""),
  vibe: z.string().max(200).optional().default(""),
});
export type PlanRequest = z.infer<typeof requestSchema>;

export const aiPlanSchema = z.object({
  summary: z.string().min(1).max(600),
  ideas: z.array(z.object({ title: z.string().min(1).max(80), description: z.string().min(1).max(300) })).min(1).max(6),
  cutExplanations: z.array(z.object({ id: z.string().max(40), reason: z.string().max(300) })).max(12),
  risks: z.array(z.string().max(250)).max(6),
});
export type AiPlan = z.infer<typeof aiPlanSchema>;

/** Free text goes into the prompt as data: strip control chars, brackets and backticks. */
export const sanitize = (s: string): string =>
  s.replace(/[\u0000-\u001f\u007f<>`{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);