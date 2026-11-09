import { describe, expect, it } from "vitest";
import { reminderRefusal } from "./guards";

describe("reminderRefusal", () => {
  it("refuses reminders on paid invoices", () => {
    expect(reminderRefusal({ number: "PL-1", status: "paid" })).toMatch(/already paid/);
  });
  it("refuses reminders on drafts", () => {
    expect(reminderRefusal({ number: "PL-1", status: "draft" })).toMatch(/draft/);
  });
  it("allows reminders on pending, underpaid and expired invoices", () => {
    for (const status of ["pending", "underpaid", "expired"] as const) {
      expect(reminderRefusal({ number: "PL-1", status })).toBeNull();
    }
  });
});
