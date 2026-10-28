import type { EventMode } from "./types.js";

export type TaskStatus = "done" | "overdue" | "due_soon" | "upcoming";
export interface Task { id: string; title: string; daysBefore: number }
export interface TimelineTask extends Task { due: string; daysLeft: number; status: TaskStatus }

const DAY = 86_400_000;
const parse = (s: string) => new Date(s + "T00:00:00Z");
const toISO = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (s: string, n: number) => toISO(new Date(parse(s).getTime() + n * DAY));
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / DAY);

export function isValidDate(s: string): boolean {
  try { return /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(parse(s)) === s; } catch { return false; }
}

/** Today's date in the user's local time, as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TASKS: Record<EventMode, Task[]> = {
  wedding: [
    { id: "w-venue", title: "Book venue and date", daysBefore: 180 },
    { id: "w-photo", title: "Book photographer and videographer", daysBefore: 150 },
    { id: "w-caterer", title: "Finalise caterer and menu tasting", daysBefore: 120 },
    { id: "w-decor", title: "Confirm decor and florist", daysBefore: 90 },
    { id: "w-invites", title: "Send invitations", daysBefore: 60 },
    { id: "w-attire", title: "Attire fittings and makeup trial", daysBefore: 45 },
    { id: "w-vendors", title: "Re-confirm all vendors and payments", daysBefore: 14 },
    { id: "w-guests", title: "Lock final guest count", daysBefore: 7 },
    { id: "w-run", title: "Share day-of run sheet with family", daysBefore: 2 },
  ],
  birthday: [
    { id: "b-venue", title: "Book venue", daysBefore: 30 },
    { id: "b-invites", title: "Send invitations", daysBefore: 21 },
    { id: "b-food", title: "Order cake and food", daysBefore: 10 },
    { id: "b-decor", title: "Buy decor and return gifts", daysBefore: 5 },
    { id: "b-confirm", title: "Confirm guests and vendors", daysBefore: 2 },
  ],
  community: [
    { id: "c-permits", title: "Apply for permissions", daysBefore: 45 },
    { id: "c-sponsors", title: "Reach out to sponsors", daysBefore: 40 },
    { id: "c-volunteers", title: "Recruit volunteers and assign roles", daysBefore: 30 },
    { id: "c-publicity", title: "Publicise the event", daysBefore: 21 },
    { id: "c-sound", title: "Book sound, stage and lighting", daysBefore: 14 },
    { id: "c-confirm", title: "Confirm vendors and volunteers", daysBefore: 7 },
    { id: "c-brief", title: "Volunteer briefing", daysBefore: 2 },
  ],
};

export function buildTimeline(
  mode: EventMode, eventDate: string, today: string, done: Set<string> = new Set(),
): TimelineTask[] {
  return TASKS[mode]
    .map((t) => {
      const due = addDays(eventDate, -t.daysBefore);
      const daysLeft = daysBetween(today, due);
      const status: TaskStatus = done.has(t.id) ? "done" : daysLeft < 0 ? "overdue" : daysLeft <= 7 ? "due_soon" : "upcoming";
      return { ...t, due, daysLeft, status };
    })
    .sort((a, b) => a.due.localeCompare(b.due));
}