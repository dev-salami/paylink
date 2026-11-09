import { describe, expect, it } from "vitest";
import { classifyInvoiceObservation } from "./payment";
import { canTransition, createInvoice, resetInvoiceSequence } from "./invoice";

describe("invoice state", () => {
  it("creates a pending invoice and allows the documented transitions", () => {
    resetInvoiceSequence(1040);
    const invoice = createInvoice({
      clientName: "Ada",
      description: "the logo",
      amount: "150",
      dueDate: "2026-11-06",
      now: new Date("2026-11-04T18:00:00.000Z"),
    });
    expect(invoice.status).toBe("pending");
    expect(invoice.number).toBe("PL-2026-1041");
    expect(canTransition("pending", "paid")).toBe(true);
    expect(canTransition("pending", "underpaid")).toBe(true);
    expect(canTransition("paid", "pending")).toBe(false);
    expect(canTransition("underpaid", "paid")).toBe(true);
    expect(canTransition("expired", "paid")).toBe(true);
  });
});

describe("classifyInvoiceObservation", () => {
  const now = new Date("2026-11-04T18:00:00.000Z");

  it("stays pending when nothing has landed", () => {
    expect(classifyInvoiceObservation({ found: false }, "2026-11-06", now).status).toBe("pending");
  });

  it("expires after the due date when nothing has landed", () => {
    const later = new Date("2026-11-07T00:00:00.000Z");
    expect(classifyInvoiceObservation({ found: false }, "2026-11-06", later).status).toBe("expired");
  });

  it("marks a short transfer underpaid and keeps the signature", () => {
    const result = classifyInvoiceObservation(
      { found: true, amountOk: false, mintOk: true, signature: "sig", amountReceived: "100" },
      "2026-11-06",
      now,
    );
    expect(result.status).toBe("underpaid");
    expect(result.signature).toBe("sig");
  });

  it("flags the wrong mint without marking the invoice paid", () => {
    const result = classifyInvoiceObservation(
      { found: true, amountOk: true, mintOk: false, signature: "sig" },
      "2026-11-06",
      now,
    );
    expect(result.status).toBe("pending");
    expect(result.issue).toBe("wrong_mint");
  });

  it("marks a matching transfer paid", () => {
    const result = classifyInvoiceObservation(
      { found: true, amountOk: true, mintOk: true, signature: "sig", amountReceived: "150" },
      "2026-11-06",
      now,
    );
    expect(result.status).toBe("paid");
  });

  it("does not mark anything paid when the RPC is down", () => {
    const result = classifyInvoiceObservation({ found: false, rpcDown: true }, "2026-11-06", now);
    expect(result.status).toBe("pending");
    expect(result.issue).toBe("rpc_down");
  });
});
