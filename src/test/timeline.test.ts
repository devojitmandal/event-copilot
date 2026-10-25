import { addDays, buildTimeline, daysBetween, isValidDate } from "../lib/timeline";

describe("timeline", () => {
  it("counts due dates back from the event date", () => {
    expect(addDays("2026-12-20", -30)).toBe("2026-11-20");
    expect(daysBetween("2026-10-25", "2026-12-20")).toBe(56);
    const venue = buildTimeline("birthday", "2026-12-20", "2026-10-25").find((t) => t.id === "b-venue")!;
    expect(venue.due).toBe("2026-11-20");
    expect(venue.status).toBe("upcoming");
  });
  it("flags tasks overdue when the date moves closer, unless done", () => {
    const late = buildTimeline("birthday", "2026-11-10", "2026-10-25");
    expect(late.find((t) => t.id === "b-venue")!.status).toBe("overdue");
    const done = buildTimeline("birthday", "2026-11-10", "2026-10-25", new Set(["b-venue"]));
    expect(done.find((t) => t.id === "b-venue")!.status).toBe("done");
  });
  it("sorts tasks by due date", () => {
    const dates = buildTimeline("wedding", "2027-03-01", "2026-10-25").map((t) => t.due);
    expect(dates).toEqual([...dates].sort());
  });
  it("validates dates", () => {
    expect(isValidDate("2026-12-20")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("abc")).toBe(false);
    expect(isValidDate("9999-99-99")).toBe(false);
  });
});