import { describe, expect, it } from "vitest";
import { isPastDue, parseDueDate } from "./dates";

const WEDNESDAY = new Date("2026-11-04T18:00:00.000Z");

describe("dates", () => {
  it("resolves weekdays and natural dates from the demo sentence", () => {
    expect(parseDueDate("Friday", WEDNESDAY)).toBe("2026-11-06");
    expect(parseDueDate("today", WEDNESDAY)).toBe("2026-11-04");
    expect(parseDueDate("tomorrow", WEDNESDAY)).toBe("2026-11-05");
    expect(parseDueDate("12 Nov", WEDNESDAY)).toBe("2026-11-12");
    expect(parseDueDate("Nov 12 2026", WEDNESDAY)).toBe("2026-11-12");
    expect(parseDueDate(undefined, WEDNESDAY)).toBe("2026-11-11");
  });

  it("treats the due date as the end of that day in Lagos", () => {
    expect(isPastDue("2026-11-04", new Date("2026-11-04T12:00:00.000Z"))).toBe(false);
    expect(isPastDue("2026-11-04", new Date("2026-11-04T23:30:00.000Z"))).toBe(true);
  });
});
