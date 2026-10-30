import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { z } from "zod";
import { applyBudgetCut, computeTotals, fitToBudget, itemCost } from "./lib/budget";
import { buildPlan } from "./lib/templates";
import type { EventMode } from "./lib/types";
import type { PlanResult } from "./server/plan";
import { addDays, buildTimeline, isValidDate, localToday } from "./lib/timeline";
import {
  compareQuotes,
  computeQuoteTotal,
  makeQuote,
  normaliseAmount,
  projectedSpendDetails,
  type GstStatus,
  type MandatoryCharge,
  type OptionalAddOn,
  type Quote,
} from "./lib/vendors";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

const MIN_BUDGET = 10_000;
const MAX_BUDGET = 100_000_000;
const MIN_GUESTS = 1;
const MAX_GUESTS = 5_000;
const STORAGE_KEY = "event-copilot-state-v2";

const clampInt = (val: number, min: number, max: number): number => {
  if (!Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, Math.round(val)));
};

const MODE_ICONS: Record<EventMode, string> = {
  wedding: "✦",
  birthday: "✶",
  community: "❖",
};

const VIBE_PRESETS: Record<EventMode, { label: string; value: string }[]> = {
  wedding: [
    { label: "🌼 Marigold & Brass Mandap", value: "traditional marigold & brass decor" },
    { label: "🌿 Intimate Temple & Banana Leaf", value: "intimate temple ritual, banana-leaf feast" },
    { label: "✨ Royal Sangeet Night", value: "evening fairy lights, live acoustic & sangeet" },
    { label: "🌸 Pastel Day Lawn", value: "outdoor daytime lawn, minimalist pastel florals" },
    { label: "♻️ Eco-Conscious & Zero-Plastic", value: "eco-friendly, zero-plastic, local seasonal flowers" },
    { label: "🍽️ Live Chaat & Filter Coffee", value: "live chaat counters, artisanal dessert & filter coffee bar" },
  ],
  birthday: [
    { label: "🏮 Terrace Sundowner", value: "rooftop terrace sundowner, warm string lights" },
    { label: "🎂 Retro 90s Nostalgia", value: "retro nostalgia theme, polaroid photo booth, custom cake" },
    { label: "🎪 Kids Carnival & Magic", value: "colourful carnival stalls, magician, snack boxes" },
    { label: "🎶 Acoustic Courtyard Dinner", value: "intimate sit-down dinner, acoustic playlist, grazing table" },
    { label: "🎮 Arcade & Board Games", value: "casual game night, finger foods, mocktail station" },
  ],
  community: [
    { label: "🪔 Cultural Utsav & Rangoli", value: "traditional pandal, rangoli courtyard, folk performances" },
    { label: "🍲 Annadanam / Community Bhandara", value: "efficient queue seating, banana-leaf community meal" },
    { label: "🎤 Open-Air Stage & Mic", value: "evening cultural stage, crisp PA sound, warm floodlights" },
    { label: "🌱 Eco-Pandal & Clay Cups", value: "sustainable cloth backdrop, kulhad chai, zero waste" },
    { label: "🏆 Society Sports & Family Day", value: "morning shamiana tents, hydration stations, family games" },
  ],
};

const CITY_PRESETS = ["Bengaluru", "Mumbai", "Delhi NCR", "Kolkata", "Chennai", "Hyderabad", "Pune", "Jaipur"];

interface DraftChargeInput {
  name: string;
  amount: string;
  pricing: "total" | "per_guest";
}

interface DraftAddOnInput {
  name: string;
  amount: string;
}

interface Draft {
  mode: EventMode;
  itemId: string;
  vendor: string;
  amount: string;
  rawAmount: number | null;
  rawPricing: "total" | "per_guest" | "unknown";
  mandatoryCharges: DraftChargeInput[];
  gst: GstStatus;
  gstRatePct: string;
  optionalAddOns: DraftAddOnInput[];
  overtimeRates: string;
  inclusions: string;
  exclusions: string;
  paymentTerms: string;
  note: string;
  confidence: string;
}

const storedQuoteSchema = z.object({
  id: z.string().min(1).max(120),
  itemId: z.string().min(1).max(40),
  vendor: z.string().min(1).max(60),
  amount: z.number().positive().max(MAX_BUDGET),
  booked: z.boolean(),
  mode: z.enum(["wedding", "birthday", "community"]).optional(),
  pricingBasis: z.enum(["fixed", "per_head"]).optional(),
  baseAmount: z.number().min(0).max(MAX_BUDGET).optional(),
  mandatoryCharges: z
    .array(
      z.object({
        name: z.string().max(80),
        amount: z.number().min(0).max(MAX_BUDGET),
        pricing: z.enum(["total", "per_guest"]),
      }),
    )
    .optional(),
  gst: z.enum(["included", "excluded", "unknown"]).optional(),
  gstRatePct: z.number().min(0).max(50).nullable().optional(),
  optionalAddOns: z
    .array(
      z.object({
        name: z.string().max(80),
        amount: z.number().min(0).max(MAX_BUDGET).nullable(),
      }),
    )
    .optional(),
  overtimeRates: z.array(z.string().max(100)).optional(),
  inclusions: z.array(z.string().max(120)).optional(),
  exclusions: z.array(z.string().max(120)).optional(),
  paymentTerms: z.string().max(300).optional(),
});

const storedStateSchema = z.object({
  mode: z.enum(["wedding", "birthday", "community"]).optional(),
  budget: z.number().int().min(MIN_BUDGET).max(MAX_BUDGET).optional(),
  guests: z.number().int().min(MIN_GUESTS).max(MAX_GUESTS).optional(),
  reserve: z.number().min(0).max(20).optional(),
  cutPct: z.number().min(0).max(40).optional(),
  city: z.string().max(60).optional(),
  vibe: z.string().max(200).optional(),
  eventDate: z.string().optional(),
  quotesByMode: z
    .object({
      wedding: z.array(storedQuoteSchema),
      birthday: z.array(storedQuoteSchema),
      community: z.array(storedQuoteSchema),
    })
    .optional(),
  doneByMode: z
    .object({
      wedding: z.array(z.string().max(60)),
      birthday: z.array(z.string().max(60)),
      community: z.array(z.string().max(60)),
    })
    .optional(),
});

type StoredState = z.infer<typeof storedStateSchema>;

function loadSavedState(): StoredState | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const validated = storedStateSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
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

function formatGstBadge(gst?: GstStatus, rate?: number | null): string | null {
  if (!gst) return null;
  if (gst === "unknown") return "GST status unknown";
  if (gst === "included") {
    return rate != null ? `GST ${rate}% incl.` : "GST incl.";
  }
  return rate != null ? `+ GST ${rate}% extra (incl. in total)` : "+ GST extra (rate unknown — excl. from total)";
}

function parseDraftMandatoryCharges(list: DraftChargeInput[]): MandatoryCharge[] {
  return list
    .map((c) => ({
      name: c.name.trim().slice(0, 80) || "Mandatory charge",
      amount: Number(c.amount),
      pricing: c.pricing,
    }))
    .filter((c) => Number.isFinite(c.amount) && c.amount > 0 && c.amount <= MAX_BUDGET);
}

export default function App() {
  const saved = useMemo(() => loadSavedState(), []);

  const [mode, setMode] = useState<EventMode>(saved?.mode ?? "wedding");
  const [budget, setBudget] = useState<number>(saved?.budget ?? 300000);
  const [budgetInput, setBudgetInput] = useState<string>(String(saved?.budget ?? 300000));
  const [guests, setGuests] = useState<number>(saved?.guests ?? 150);
  const [guestsInput, setGuestsInput] = useState<string>(String(saved?.guests ?? 150));
  const [reserve, setReserve] = useState<number>(saved?.reserve ?? 10);
  const [cutPct, setCutPct] = useState<number>(saved?.cutPct ?? 0);
  const [city, setCity] = useState<string>(saved?.city ?? "");
  const [vibe, setVibe] = useState<string>(saved?.vibe ?? "");
  const [eventDate, setEventDate] = useState<string>(() =>
    saved?.eventDate && isValidDate(saved.eventDate) ? saved.eventDate : addDays(localToday(), 120),
  );
  const [doneByMode, setDoneByMode] = useState<Record<EventMode, Set<string>>>(() => ({
    wedding: new Set(saved?.doneByMode?.wedding ?? []),
    birthday: new Set(saved?.doneByMode?.birthday ?? []),
    community: new Set(saved?.doneByMode?.community ?? []),
  }));
  const [quotesByMode, setQuotesByMode] = useState<Record<EventMode, Quote[]>>(() => ({
    wedding: saved?.quotesByMode?.wedding ?? [],
    birthday: saved?.quotesByMode?.birthday ?? [],
    community: saved?.quotesByMode?.community ?? [],
  }));
  const [qItem, setQItem] = useState("");
  const [qVendor, setQVendor] = useState("");
  const [qAmount, setQAmount] = useState("");
  const [qGstStatus, setQGstStatus] = useState<GstStatus>("unknown");
  const [qGstRate, setQGstRate] = useState<string>("");
  const [qError, setQError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [xError, setXError] = useState("");
  const [ai, setAi] = useState<{ key: string; result: PlanResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const safeBudget = clampInt(budget, MIN_BUDGET, MAX_BUDGET);
  const safeGuests = clampInt(guests, MIN_GUESTS, MAX_GUESTS);
  const safeReserve = clampInt(reserve, 0, 20);
  const safeCutPct = clampInt(cutPct, 0, 40);

  const activeModeRef = useRef<EventMode>(mode);
  activeModeRef.current = mode;
  const activeGuestsRef = useRef<number>(safeGuests);
  activeGuestsRef.current = safeGuests;
  const extractSeqRef = useRef(0);

  useEffect(() => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      const toStore: StoredState = {
        mode,
        budget: safeBudget,
        guests: safeGuests,
        reserve: safeReserve,
        cutPct: safeCutPct,
        city,
        vibe,
        eventDate,
        quotesByMode,
        doneByMode: {
          wedding: [...doneByMode.wedding],
          birthday: [...doneByMode.birthday],
          community: [...doneByMode.community],
        },
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch {
      // Ignore storage quota errors
    }
  }, [mode, safeBudget, safeGuests, safeReserve, safeCutPct, city, vibe, eventDate, quotesByMode, doneByMode]);

  const quotes = quotesByMode[mode];
  const done = doneByMode[mode];

  function handleModeChange(nextMode: EventMode) {
    if (nextMode === mode) return;
    if (extracting) {
      extractSeqRef.current += 1;
      setExtracting(false);
      setXError(`Switched to ${nextMode} mode. Previous quote upload was cancelled.`);
    }
    setDraft(null);
    setQError("");
    setMode(nextMode);
  }

  function handleGuestsChange(nextGuests: number) {
    const nextSafe = clampInt(nextGuests, MIN_GUESTS, MAX_GUESTS);
    if (extracting && nextSafe !== activeGuestsRef.current) {
      extractSeqRef.current += 1;
      setExtracting(false);
      setDraft(null);
      setXError("Guest count changed while reading the quotation. Please upload the file again.");
    }
    setGuests(nextGuests);
  }

  const view = useMemo(() => {
    const base = computeTotals([], safeGuests, safeBudget, safeReserve);
    const plan = buildPlan(mode, base.available, safeGuests);
    const newBudget = applyBudgetCut(safeBudget, safeCutPct);
    const target = computeTotals([], safeGuests, newBudget, safeReserve).available;
    const fit = fitToBudget(plan, safeGuests, target);
    return {
      plan: fit.items,
      cuts: fit.cuts,
      shortfall: fit.shortfall,
      newBudget,
      totals: computeTotals(fit.items, safeGuests, newBudget, safeReserve),
    };
  }, [mode, safeBudget, safeGuests, safeReserve, safeCutPct]);

  const today = localToday();
  const timeline = useMemo(
    () => (isValidDate(eventDate) ? buildTimeline(mode, eventDate, today, done) : []),
    [mode, eventDate, today, done],
  );
  const overdue = timeline.filter((t) => t.status === "overdue").length;

  function toggle(id: string) {
    setDoneByMode((prev) => {
      const nextSet = new Set(prev[mode]);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return { ...prev, [mode]: nextSet };
    });
  }

  function toggleVibePreset(snippet: string) {
    setVibe((prev) => {
      const parts = prev
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const exists = parts.some((p) => p.toLowerCase() === snippet.toLowerCase());
      const nextParts = exists
        ? parts.filter((p) => p.toLowerCase() !== snippet.toLowerCase())
        : [...parts, snippet];
      return nextParts.join(", ").slice(0, 200);
    });
  }

  const quoteItem = view.plan.find((i) => i.id === qItem) ?? view.plan[0];
  const projection = projectedSpendDetails(view.plan, quotes, safeGuests, mode);
  const projected = projection.total;
  const available = view.totals.available;
  const hasExcludedUnknownGst = projection.excludedUnknownGstItems.length > 0;
  const hasUnknownGstStatus = projection.unknownGstStatusItems.length > 0;

  function addQuote() {
    let parsedRate: number | null = null;
    if (qGstStatus === "excluded" && qGstRate.trim() !== "") {
      const r = Number(qGstRate);
      if (!Number.isFinite(r) || r < 0 || r > 50) {
        setQError("Enter a valid GST rate between 0% and 50%, or leave it blank if unknown.");
        return;
      }
      parsedRate = r;
    }
    const q = makeQuote(quoteItem.id, qVendor, Number(qAmount), {
      mode,
      pricingBasis: quoteItem.basis,
      gst: qGstStatus,
      gstRatePct: parsedRate,
    });
    if (!q) {
      setQError("Enter a vendor name and an amount between ₹1 and ₹10,00,00,000.");
      return;
    }
    setQError("");
    setQuotesByMode((prev) => ({ ...prev, [mode]: [...prev[mode], q] }));
    setQVendor("");
    setQAmount("");
    setQGstStatus("unknown");
    setQGstRate("");
  }

  function setBooked(id: string) {
    setQuotesByMode((prev) => {
      const current = prev[mode];
      const target = current.find((q) => q.id === id);
      if (!target) return prev;
      const updated = current.map((q) =>
        q.itemId !== target.itemId ? q : q.id === id ? { ...q, booked: !q.booked } : { ...q, booked: false },
      );
      return { ...prev, [mode]: updated };
    });
  }

  const removeQuote = (id: string) =>
    setQuotesByMode((prev) => ({ ...prev, [mode]: prev[mode].filter((q) => q.id !== id) }));

  const activeDraft = draft && draft.mode === mode ? draft : null;
  const draftItem = activeDraft ? view.plan.find((i) => i.id === activeDraft.itemId) ?? quoteItem : null;

  function upd(
    k:
      | "itemId"
      | "vendor"
      | "amount"
      | "gst"
      | "gstRatePct"
      | "overtimeRates"
      | "inclusions"
      | "exclusions"
      | "paymentTerms",
    v: string,
  ) {
    setDraft((d) => {
      if (!d) return null;
      if (k === "itemId") {
        const nextItem = view.plan.find((i) => i.id === v);
        if (nextItem && d.rawAmount != null) {
          const norm = normaliseAmount(d.rawPricing, d.rawAmount, nextItem.basis, safeGuests);
          return {
            ...d,
            itemId: v,
            amount: norm.amount != null ? String(norm.amount) : d.amount,
            note: norm.note,
          };
        }
      }
      return { ...d, [k]: v };
    });
  }

  function updateDraftMandatory(idx: number, field: keyof DraftChargeInput, value: string) {
    setDraft((d) => {
      if (!d) return null;
      const next = d.mandatoryCharges.map((item, i) => (i === idx ? { ...item, [field]: value } : item));
      return { ...d, mandatoryCharges: next };
    });
  }

  function addDraftMandatory() {
    setDraft((d) =>
      d
        ? {
            ...d,
            mandatoryCharges: [...d.mandatoryCharges, { name: "", amount: "", pricing: "total" }],
          }
        : null,
    );
  }

  function removeDraftMandatory(idx: number) {
    setDraft((d) => (d ? { ...d, mandatoryCharges: d.mandatoryCharges.filter((_, i) => i !== idx) } : null));
  }

  function updateDraftAddOn(idx: number, field: keyof DraftAddOnInput, value: string) {
    setDraft((d) => {
      if (!d) return null;
      const next = d.optionalAddOns.map((item, i) => (i === idx ? { ...item, [field]: value } : item));
      return { ...d, optionalAddOns: next };
    });
  }

  function addDraftAddOn() {
    setDraft((d) => (d ? { ...d, optionalAddOns: [...d.optionalAddOns, { name: "", amount: "" }] } : null));
  }

  function removeDraftAddOn(idx: number) {
    setDraft((d) => (d ? { ...d, optionalAddOns: d.optionalAddOns.filter((_, i) => i !== idx) } : null));
  }

  const draftPlanned = draftItem ? itemCost(draftItem, safeGuests) : 0;
  const parsedDraftGstRate =
    activeDraft && activeDraft.gst === "excluded" && activeDraft.gstRatePct.trim() !== ""
      ? Number(activeDraft.gstRatePct)
      : null;

  const draftTotal =
    activeDraft && draftItem
      ? computeQuoteTotal(Number(activeDraft.amount || 0), draftItem.basis, safeGuests, {
          pricingBasis: draftItem.basis,
          mandatoryCharges: parseDraftMandatoryCharges(activeDraft.mandatoryCharges),
          gst: activeDraft.gst,
          gstRatePct: parsedDraftGstRate,
        })
      : 0;
  const draftSuspicious = draftTotal > available;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setXError("");
    setDraft(null);
    if (!ACCEPT.includes(file.type)) {
      setXError("Use a PDF, PNG, JPG or WebP file.");
      return;
    }
    if (file.size > MAX_FILE) {
      setXError("File is too large. Keep it under 3 MB.");
      return;
    }

    const uploadMode = mode;
    const uploadGuests = safeGuests;
    const uploadPlanSnapshot = view.plan;
    const uploadCategories = uploadPlanSnapshot.map((i) => ({ id: i.id, label: i.label }));
    const reqId = ++extractSeqRef.current;

    setExtracting(true);
    try {
      const data = await readBase64(file);
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mimeType: file.type,
          data,
          categories: uploadCategories,
        }),
      });
      const out = await res.json().catch(() => ({}));

      if (reqId !== extractSeqRef.current || activeModeRef.current !== uploadMode) {
        return;
      }
      if (activeGuestsRef.current !== uploadGuests) {
        setXError("Guest count changed while reading the quotation. Please upload the file again.");
        return;
      }

      if (!res.ok) throw new Error(out.error ?? "The server had a problem. Please try again.");
      const d = out.draft;
      const matchedItem = uploadPlanSnapshot.find((i) => i.id === d.categoryId) ?? uploadPlanSnapshot[0];
      const rawAmount: number | null = d.baseAmount ?? d.amount ?? null;
      const norm = normaliseAmount(d.pricing, rawAmount, matchedItem.basis, uploadGuests);

      const rawMandatory: MandatoryCharge[] = Array.isArray(d.mandatoryCharges) ? d.mandatoryCharges : [];
      const rawAddOns: OptionalAddOn[] = Array.isArray(d.optionalAddOns) ? d.optionalAddOns : [];

      setDraft({
        mode: uploadMode,
        itemId: matchedItem.id,
        vendor: d.vendor ?? "",
        amount: norm.amount != null ? String(norm.amount) : "",
        rawAmount,
        rawPricing: d.pricing ?? "unknown",
        mandatoryCharges: rawMandatory.map((mc) => ({
          name: mc.name ?? "Mandatory charge",
          amount: String(mc.amount ?? ""),
          pricing: mc.pricing === "per_guest" ? "per_guest" : "total",
        })),
        gst: d.gst ?? "unknown",
        gstRatePct: d.gstRatePct != null ? String(d.gstRatePct) : "",
        optionalAddOns: rawAddOns.map((ao) => ({
          name: ao.name ?? "",
          amount: ao.amount != null ? String(ao.amount) : "",
        })),
        overtimeRates: Array.isArray(d.overtimeRates) ? d.overtimeRates.join("\n") : "",
        inclusions: Array.isArray(d.inclusions) ? d.inclusions.join("\n") : "",
        exclusions: Array.isArray(d.exclusions) ? d.exclusions.join("\n") : "",
        paymentTerms: d.paymentTerms ?? "",
        note: norm.note,
        confidence: d.confidence ?? "low",
      });
    } catch (err) {
      if (reqId !== extractSeqRef.current || activeModeRef.current !== uploadMode) {
        return;
      }
      setXError(
        (err instanceof Error ? err.message : "Extraction failed.") + " You can enter the quote manually below.",
      );
    } finally {
      if (reqId === extractSeqRef.current) {
        setExtracting(false);
      }
    }
  }

  function confirmDraft() {
    if (!activeDraft || !draftItem) return;
    const lines = (s: string, maxLen = 120, maxItems = 10) =>
      s
        .split("\n")
        .map((x) => x.trim().slice(0, maxLen))
        .filter(Boolean)
        .slice(0, maxItems);

    if (activeDraft.gst === "excluded" && activeDraft.gstRatePct.trim() !== "") {
      const rateNum = Number(activeDraft.gstRatePct);
      if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 50) {
        setXError("GST rate must be between 0% and 50%, or left blank if unknown.");
        return;
      }
    }

    const expectedNorm = normaliseAmount(activeDraft.rawPricing, activeDraft.rawAmount, draftItem.basis, safeGuests);
    const amountUnchanged =
      activeDraft.rawAmount != null &&
      expectedNorm.amount != null &&
      Math.abs(Number(activeDraft.amount) - expectedNorm.amount) < 0.001;

    const useOriginalBasis =
      amountUnchanged && (activeDraft.rawPricing === "total" || activeDraft.rawPricing === "per_guest");
    const finalAmount = useOriginalBasis ? activeDraft.rawAmount! : Number(activeDraft.amount);
    const finalBasis = useOriginalBasis
      ? activeDraft.rawPricing === "per_guest"
        ? "per_head"
        : "fixed"
      : draftItem.basis;

    const cleanedMandatory = parseDraftMandatoryCharges(activeDraft.mandatoryCharges);
    const cleanedAddOns: OptionalAddOn[] = activeDraft.optionalAddOns
      .map((a) => {
        const trimmedName = a.name.trim().slice(0, 80);
        const rawAmt = a.amount.trim();
        const parsedAmt = rawAmt !== "" && Number.isFinite(Number(rawAmt)) && Number(rawAmt) >= 0 ? Number(rawAmt) : null;
        return { name: trimmedName, amount: parsedAmt };
      })
      .filter((a) => Boolean(a.name))
      .slice(0, 8);

    const q = makeQuote(activeDraft.itemId, activeDraft.vendor, finalAmount, {
      mode: activeDraft.mode,
      pricingBasis: finalBasis,
      baseAmount: finalAmount,
      mandatoryCharges: cleanedMandatory,
      gst: activeDraft.gst,
      gstRatePct:
        activeDraft.gst === "excluded" && activeDraft.gstRatePct.trim() !== ""
          ? Number(activeDraft.gstRatePct)
          : null,
      optionalAddOns: cleanedAddOns,
      overtimeRates: lines(activeDraft.overtimeRates, 100, 6),
      inclusions: lines(activeDraft.inclusions, 120, 10),
      exclusions: lines(activeDraft.exclusions, 120, 10),
      paymentTerms: activeDraft.paymentTerms.trim().slice(0, 300),
    });
    if (!q) {
      setXError("A vendor name and a base amount above 0 are required.");
      return;
    }
    setQuotesByMode((prev) => ({ ...prev, [activeDraft.mode]: [...prev[activeDraft.mode], q] }));
    setDraft(null);
    setXError("");
  }

  const payload = {
    mode,
    budget: safeBudget,
    guests: safeGuests,
    reservePct: safeReserve,
    cutPct: safeCutPct,
    city: city.trim().slice(0, 60),
    vibe: vibe.trim().slice(0, 200),
  };
  const key = JSON.stringify(payload);

  async function generate() {
    const parsedBudget = Number(budgetInput);
    const parsedGuests = Number(guestsInput);
    if (!Number.isInteger(parsedBudget) || parsedBudget < MIN_BUDGET || parsedBudget > MAX_BUDGET) {
      setError("Budget must be a whole rupee amount between ₹10,000 and ₹10,00,00,000.");
      return;
    }
    if (!Number.isInteger(parsedGuests) || parsedGuests < MIN_GUESTS || parsedGuests > MAX_GUESTS) {
      setError("Guests must be a whole number between 1 and 5,000.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: key,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "The server had a problem. Please try again.");
      setAi({ key, result: data });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const stale = ai && ai.key !== key;
  const reasons = new Map(ai?.result.plan.cutExplanations.map((c) => [c.id, c.reason]));
  const perGuestPlanned = safeGuests > 0 ? Math.round(view.totals.planned / safeGuests) : 0;

  return (
    <main>
      <header className="hero-header">
        <span className="festive-eyebrow">✦ Celebration & Budget Studio ✦</span>
        <h1>Event Copilot</h1>
        <p className="sub">Budget-first planning. Estimates only: enter real vendor quotes as you get them.</p>

        <div className="row mode-bar">
          {(["wedding", "birthday", "community"] as const).map((m) => {
            const modeQuoteCount = quotesByMode[m].length;
            return (
              <button key={m} aria-pressed={mode === m} onClick={() => handleModeChange(m)}>
                <span aria-hidden="true">{MODE_ICONS[m]}</span> {m}
                {modeQuoteCount > 0 && (
                  <span className="mode-badge" aria-label={`${modeQuoteCount} quotes`}>
                    {modeQuoteCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      <section className="kpi-ribbon" aria-label="Budget summary metrics">
        <div className="kpi-card">
          <div className="kpi-label">Available to Spend</div>
          <div className="kpi-value">{inr(available)}</div>
          <div className="kpi-meta">After {inr(view.totals.reserve)} emergency reserve</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total Planned</div>
          <div className="kpi-value">{inr(view.totals.planned)}</div>
          <div className="kpi-meta">~{inr(perGuestPlanned)} per guest ({safeGuests} guests)</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Projected w/ Quotes</div>
          <div className="kpi-value">
            {inr(projected)}
            {hasExcludedUnknownGst ? " + GST" : ""}
          </div>
          <div className="kpi-meta">
            {projected <= available
              ? `${inr(available - projected)} under available`
              : `${inr(projected - available)} over available`}
            {hasExcludedUnknownGst
              ? ` (excludes unpriced GST on ${projection.excludedUnknownGstItems.join(", ")})`
              : hasUnknownGstStatus
                ? ` (GST status unconfirmed on ${projection.unknownGstStatusItems.join(", ")})`
                : ""}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="grid">
          <label>
            Budget (₹)
            <input
              type="number"
              min={MIN_BUDGET}
              max={MAX_BUDGET}
              step={1}
              value={budgetInput}
              onChange={(e) => {
                const rawStr = e.target.value;
                setBudgetInput(rawStr);
                const parsed = Number(rawStr);
                if (rawStr !== "" && Number.isFinite(parsed)) {
                  setBudget(parsed);
                }
              }}
              onBlur={() => {
                const clamped = clampInt(Number(budgetInput), MIN_BUDGET, MAX_BUDGET);
                setBudget(clamped);
                setBudgetInput(String(clamped));
              }}
            />
          </label>
          <label>
            Guests
            <input
              type="number"
              min={MIN_GUESTS}
              max={MAX_GUESTS}
              step={1}
              value={guestsInput}
              onChange={(e) => {
                const rawStr = e.target.value;
                setGuestsInput(rawStr);
                const parsed = Number(rawStr);
                if (rawStr !== "" && Number.isFinite(parsed)) {
                  handleGuestsChange(parsed);
                }
              }}
              onBlur={() => {
                const clamped = clampInt(Number(guestsInput), MIN_GUESTS, MAX_GUESTS);
                handleGuestsChange(clamped);
                setGuestsInput(String(clamped));
              }}
            />
          </label>
          <label>
            Reserve ({safeReserve}%)
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={safeReserve}
              onChange={(e) => setReserve(clampInt(+e.target.value, 0, 20))}
            />
          </label>
          <label>
            Cut budget by {safeCutPct}%
            <input
              type="range"
              min={0}
              max={40}
              step={1}
              value={safeCutPct}
              onChange={(e) => setCutPct(clampInt(+e.target.value, 0, 40))}
            />
          </label>
          <label>
            Event date
            <input type="date" min={today} value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </label>
          <label>
            City
            <input
              maxLength={60}
              placeholder="e.g. Bengaluru"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </label>
          <label className="field-span-full">
            Vibe or notes
            <input
              maxLength={200}
              placeholder="e.g. simple, traditional, outdoor — or click presets below"
              value={vibe}
              onChange={(e) => setVibe(e.target.value)}
            />
          </label>
        </div>

        <div className="preset-group">
          <div className="preset-header">
            <span>Quick City</span>
          </div>
          <div className="preset-tray">
            {CITY_PRESETS.map((c) => {
              const active = city.trim().toLowerCase() === c.toLowerCase();
              return (
                <button
                  key={c}
                  type="button"
                  className={`preset-chip ${active ? "active" : ""}`}
                  onClick={() => setCity(active ? "" : c)}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <div className="preset-group" style={{ marginTop: "0.85rem" }}>
          <div className="preset-header">
            <span>Curated {mode} vibes & notes (click to combine)</span>
            {vibe && (
              <button type="button" className="preset-clear" onClick={() => setVibe("")}>
                Clear notes
              </button>
            )}
          </div>
          <div className="preset-tray">
            {VIBE_PRESETS[mode].map((preset) => {
              const isSelected = vibe.toLowerCase().includes(preset.value.toLowerCase());
              return (
                <button
                  key={preset.label}
                  type="button"
                  className={`preset-chip ${isSelected ? "active" : ""}`}
                  onClick={() => toggleVibePreset(preset.value)}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className="workspace-split">
        <section className="panel">
          <h2>✦ Budget Allocation</h2>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>Planned</th>
              </tr>
            </thead>
            <tbody>
              {view.plan.map((i) => {
                const cost = itemCost(i, safeGuests);
                const pct = view.totals.planned > 0 ? Math.min(100, Math.round((cost / view.totals.planned) * 100)) : 0;
                return (
                  <tr key={i.id}>
                    <td>
                      {i.label}
                      {reasons.get(i.id) && !stale && <small>{reasons.get(i.id)}</small>}
                      <div className="alloc-bar" aria-hidden="true">
                        <div className="alloc-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td>{i.basis === "per_head" ? "per guest" : "fixed"}</td>
                    <td>{inr(cost)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Reserve</td>
                <td>{inr(view.totals.reserve)}</td>
              </tr>
              <tr>
                <td colSpan={2}>Total planned (excl. reserve)</td>
                <td>{inr(view.totals.planned)}</td>
              </tr>
            </tfoot>
          </table>

          {view.cuts.length > 0 && (
            <p className="cuts-banner">
              Cuts made: {view.cuts.map((c) => `${c.label} (−${inr(c.saved)})`).join(", ")}
            </p>
          )}
          {view.shortfall > 0 && (
            <p role="alert">
              Still {inr(view.shortfall)} over, even at each item's minimum. Reduce guests or raise the budget.
            </p>
          )}
        </section>

        <section className="panel">
          <h2>✦ Timeline</h2>
          {timeline.length === 0 ? (
            <p role="alert">Pick a valid event date.</p>
          ) : (
            <>
              {overdue > 0 && (
                <p role="alert">
                  {overdue} task(s) should already be done for this date. Move the date later or fast-track them.
                </p>
              )}
              <ul className="tasks">
                {timeline.map((t) => (
                  <li key={t.id}>
                    <label className="task">
                      <input type="checkbox" checked={t.status === "done"} onChange={() => toggle(t.id)} />
                      <span>{t.title}</span>
                    </label>
                    <span className={`chip ${t.status}`}>
                      {t.status === "done"
                        ? "done"
                        : t.status === "overdue"
                          ? `${-t.daysLeft}d overdue`
                          : `due ${t.due}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>✦ Vendor quotes ({mode})</h2>
        <div className="upload">
          <label>
            Upload a quotation (PDF, PNG, JPG or WebP, up to 3 MB)
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={onFile}
              disabled={extracting}
            />
          </label>
          {extracting && <p aria-live="polite">Reading the quotation…</p>}
          {xError && <p role="alert">{xError}</p>}

          {activeDraft && draftItem && (
            <div className="draft">
              <h3>Review the extracted quote</h3>
              <p className="sub">
                AI confidence: {activeDraft.confidence}. Check and edit every field before saving. If you change the
                category, re-check the amount.{activeDraft.note && ` ${activeDraft.note}`}
              </p>

              <div className="grid">
                <label>
                  Category
                  <select value={activeDraft.itemId} onChange={(e) => upd("itemId", e.target.value)}>
                    {view.plan.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Vendor
                  <input maxLength={60} value={activeDraft.vendor} onChange={(e) => upd("vendor", e.target.value)} />
                </label>
                <label>
                  {draftItem.basis === "per_head" ? "Base quote per guest (₹)" : "Base quote total (₹)"}
                  <input
                    type="number"
                    min={1}
                    max={MAX_BUDGET}
                    step="any"
                    value={activeDraft.amount}
                    onChange={(e) => upd("amount", e.target.value)}
                  />
                </label>
                <label>
                  GST status
                  <select value={activeDraft.gst} onChange={(e) => upd("gst", e.target.value as GstStatus)}>
                    <option value="included">GST included</option>
                    <option value="excluded">GST extra</option>
                    <option value="unknown">GST unknown</option>
                  </select>
                </label>
                {activeDraft.gst === "excluded" && (
                  <label>
                    GST rate (%)
                    <input
                      type="number"
                      min={0}
                      max={50}
                      step="any"
                      placeholder="Unknown"
                      value={activeDraft.gstRatePct}
                      onChange={(e) => upd("gstRatePct", e.target.value)}
                    />
                  </label>
                )}
              </div>

              <div className="draft-list-section">
                <div className="draft-list-header">
                  <span>Mandatory charges (compulsory setup, delivery, etc.)</span>
                  <button type="button" className="preset-chip" onClick={addDraftMandatory}>
                    + Add mandatory charge
                  </button>
                </div>
                {activeDraft.mandatoryCharges.map((mc, idx) => (
                  <div key={idx} className="draft-list-row">
                    <input
                      placeholder="Charge name (e.g. Setup)"
                      maxLength={80}
                      value={mc.name}
                      onChange={(e) => updateDraftMandatory(idx, "name", e.target.value)}
                    />
                    <input
                      type="number"
                      min={0}
                      max={MAX_BUDGET}
                      step="any"
                      placeholder="Amount (₹)"
                      value={mc.amount}
                      onChange={(e) => updateDraftMandatory(idx, "amount", e.target.value)}
                    />
                    <select
                      value={mc.pricing}
                      onChange={(e) =>
                        updateDraftMandatory(idx, "pricing", e.target.value as "total" | "per_guest")
                      }
                    >
                      <option value="total">Fixed total</option>
                      <option value="per_guest">Per guest</option>
                    </select>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => removeDraftMandatory(idx)}
                      aria-label={`Remove mandatory charge ${idx + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div className="draft-list-section">
                <div className="draft-list-header">
                  <span>Optional add-ons (kept separate from base quote total)</span>
                  <button type="button" className="preset-chip" onClick={addDraftAddOn}>
                    + Add optional add-on
                  </button>
                </div>
                {activeDraft.optionalAddOns.map((ao, idx) => (
                  <div key={idx} className="draft-list-row">
                    <input
                      placeholder="Add-on name (e.g. Pre-wedding shoot)"
                      maxLength={80}
                      value={ao.name}
                      onChange={(e) => updateDraftAddOn(idx, "name", e.target.value)}
                    />
                    <input
                      type="number"
                      min={0}
                      max={MAX_BUDGET}
                      step="any"
                      placeholder="Amount (₹, optional)"
                      value={ao.amount}
                      onChange={(e) => updateDraftAddOn(idx, "amount", e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => removeDraftAddOn(idx)}
                      aria-label={`Remove optional add-on ${idx + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <p className="sub">
                Total for {safeGuests} guests: <strong>{inr(draftTotal)}</strong> (plan: {inr(draftPlanned)}).
                {activeDraft.gst === "excluded" && parsedDraftGstRate == null && (
                  <span className="tax-warning-inline">
                    {" "}
                    Excludes unknown GST — enter the GST rate (%) above to include tax in the total.
                  </span>
                )}
              </p>

              {draftSuspicious && (
                <p role="alert">
                  This is more than your whole available budget. Check whether the amount is per guest or the total.
                </p>
              )}

              <label>
                Overtime rates (one per line)
                <textarea
                  rows={2}
                  value={activeDraft.overtimeRates}
                  onChange={(e) => upd("overtimeRates", e.target.value)}
                />
              </label>
              <label>
                Includes (one per line)
                <textarea rows={3} value={activeDraft.inclusions} onChange={(e) => upd("inclusions", e.target.value)} />
              </label>
              <label>
                Excludes (one per line)
                <textarea rows={3} value={activeDraft.exclusions} onChange={(e) => upd("exclusions", e.target.value)} />
              </label>
              <label>
                Payment terms
                <input
                  maxLength={300}
                  value={activeDraft.paymentTerms}
                  onChange={(e) => upd("paymentTerms", e.target.value)}
                />
              </label>
              <div className="row">
                <button className="btn-primary" onClick={confirmDraft}>
                  Confirm and add quote
                </button>
                <button className="btn-ghost" onClick={() => setDraft(null)}>
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="grid">
          <label>
            Category
            <select value={quoteItem.id} onChange={(e) => setQItem(e.target.value)}>
              {view.plan.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vendor
            <input maxLength={60} value={qVendor} onChange={(e) => setQVendor(e.target.value)} />
          </label>
          <label>
            {quoteItem.basis === "per_head" ? "Quote per guest (₹)" : "Quote total (₹)"}
            <input
              type="number"
              min={1}
              max={MAX_BUDGET}
              step="any"
              value={qAmount}
              onChange={(e) => setQAmount(e.target.value)}
            />
          </label>
          <label>
            GST status
            <select value={qGstStatus} onChange={(e) => setQGstStatus(e.target.value as GstStatus)}>
              <option value="unknown">GST unknown</option>
              <option value="included">GST included</option>
              <option value="excluded">GST extra</option>
            </select>
          </label>
          {qGstStatus === "excluded" && (
            <label>
              GST rate (%)
              <input
                type="number"
                min={0}
                max={50}
                step="any"
                placeholder="e.g. 18 (leave blank if unknown)"
                value={qGstRate}
                onChange={(e) => setQGstRate(e.target.value)}
              />
            </label>
          )}
        </div>
        <div className="row">
          <button className="btn-primary" onClick={addQuote}>
            Add quote
          </button>
        </div>
        {qError && <p role="alert">{qError}</p>}

        {view.plan.map((item) => {
          const rows = compareQuotes(quotes, item, safeGuests, mode);
          if (rows.length === 0) return null;
          return (
            <div key={item.id} className="quote-group">
              <h3>
                {item.label}
                <small>Planned {inr(itemCost(item, safeGuests))}</small>
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Quote</th>
                    <th>Vs plan</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const gstBadge = formatGstBadge(r.gst, r.gstRatePct);
                    return (
                      <tr key={r.id}>
                        <td>
                          {r.vendor}
                          {r.best && <span className="chip good">lowest</span>}
                          {r.booked && <span className="chip due_soon">booked</span>}
                          {gstBadge && (
                            <span
                              className={`chip ${
                                r.excludesUnknownGst
                                  ? "overdue"
                                  : r.gst === "excluded" || r.gstUnknown
                                    ? "due_soon"
                                    : "good"
                              }`}
                            >
                              {gstBadge}
                            </span>
                          )}
                          {r.mandatoryCharges && r.mandatoryCharges.length > 0 && (
                            <small>
                              Mandatory charges:{" "}
                              {r.mandatoryCharges
                                .map(
                                  (mc) =>
                                    `${mc.name} (${inr(mc.amount)}${mc.pricing === "per_guest" ? "/guest" : " total"})`,
                                )
                                .join(", ")}
                            </small>
                          )}
                          {r.optionalAddOns && r.optionalAddOns.length > 0 && (
                            <div className="breakdown-badges">
                              {r.optionalAddOns.map((addon, idx) => (
                                <span key={idx} className="chip addon-chip">
                                  Optional: {addon.name}
                                  {addon.amount != null ? ` (${inr(addon.amount)})` : " (price unknown)"}
                                </span>
                              ))}
                            </div>
                          )}
                          {r.overtimeRates && r.overtimeRates.length > 0 && (
                            <small>Overtime: {r.overtimeRates.join(" • ")}</small>
                          )}
                          {r.inclusions?.length ? <small>Includes: {r.inclusions.join(", ")}</small> : null}
                          {r.exclusions?.length ? <small>Excludes: {r.exclusions.join(", ")}</small> : null}
                          {r.paymentTerms ? <small>Payment: {r.paymentTerms}</small> : null}
                        </td>
                        <td>
                          {inr(r.total)}
                          {r.excludesUnknownGst && <small>+ unknown GST</small>}
                          {r.gstUnknown && <small>GST unconfirmed</small>}
                        </td>
                        <td>
                          {r.diff > 0 ? `${inr(r.diff)} over` : `${inr(-r.diff)} under`}
                          {r.excludesUnknownGst ? " (excl. GST)" : ""}
                        </td>
                        <td>
                          <button onClick={() => setBooked(r.id)}>{r.booked ? "Unbook" : "Book"}</button>{" "}
                          <button
                            className="btn-ghost"
                            onClick={() => removeQuote(r.id)}
                            aria-label={`Remove ${r.vendor}`}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}

        <p className="projected-banner">
          <span>
            Projected spend with booked quotes: {inr(projected)}
            {hasExcludedUnknownGst ? " (+ unpriced GST)" : ""} of {inr(available)} available (
            {projected <= available ? `${inr(available - projected)} left` : `${inr(projected - available)} over`}).
          </span>
          {(hasExcludedUnknownGst || hasUnknownGstStatus) && (
            <small className="tax-warning-inline">
              {hasExcludedUnknownGst
                ? `⚠️ Excludes unknown GST rate on: ${projection.excludedUnknownGstItems.join(", ")}.`
                : `⚠️ GST status unconfirmed on: ${projection.unknownGstStatusItems.join(", ")}.`}
            </small>
          )}
        </p>
      </section>

      <section className="ai-panel">
        <div className="row">
          <button className="btn-primary" onClick={generate} disabled={loading}>
            {loading ? "Generating…" : "Generate AI plan"}
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {stale && <p className="sub">Inputs changed since this plan. Generate again to refresh it.</p>}
        {ai && (
          <section aria-live="polite">
            <p className="sub">
              {ai.result.source === "ai"
                ? "Written by Gemini. Numbers come from the budget engine."
                : `Template plan, not AI (${ai.result.reason}).`}
            </p>
            <p>{ai.result.plan.summary}</p>
            <h2>Ideas</h2>
            <ul className="ai-ideas">
              {ai.result.plan.ideas.map((i) => (
                <li key={i.title}>
                  <strong>{i.title}</strong>: {i.description}
                </li>
              ))}
            </ul>
            {ai.result.plan.risks.length > 0 && (
              <>
                <h2>Risks</h2>
                <ul>
                  {ai.result.plan.risks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </section>
    </main>
  );
}