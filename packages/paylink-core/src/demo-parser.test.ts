import { describe, expect, it } from "vitest";
import { parseDemoCommand } from "./demo-parser";

const now = new Date("2026-11-04T18:00:00.000Z");

describe("parseDemoCommand", () => {
  it("parses the demo sentence", () => {
    const intent = parseDemoCommand("invoice Ada 150 USDC for the logo, due Friday", now);
    expect(intent).toMatchObject({
      type: "create_invoice",
      clientName: "Ada",
      amount: "150",
      description: "the logo",
      dueDate: "2026-11-06",
      asDraft: false,
    });
  });

  it("parses a multi-word client, an email, and a draft", () => {
    const intent = parseDemoCommand(
      "draft invoice Ada Lovelace ada@harbour.co 80.5 USDC for brand guidelines, due 12 Nov",
      now,
    );
    expect(intent).toMatchObject({
      type: "create_invoice",
      clientName: "Ada Lovelace",
      clientEmail: "ada@harbour.co",
      amount: "80.5",
      description: "brand guidelines",
      dueDate: "2026-11-12",
      asDraft: true,
    });
  });

  it("routes the other tools", () => {
    expect(parseDemoCommand("what's still unpaid?", now).type).toBe("list_unpaid");
    expect(parseDemoCommand("check status of Ada", now)).toMatchObject({ type: "check_status", query: "Ada" });
    expect(parseDemoCommand("send Ada a reminder", now)).toMatchObject({ type: "send_reminder", query: "Ada" });
    expect(parseDemoCommand("make a branded PDF for Ada", now)).toMatchObject({
      type: "generate_pdf",
      query: "Ada",
    });
  });
});
