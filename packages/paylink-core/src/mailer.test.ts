import { describe, expect, it } from "vitest";
import { createConsoleMailer, createResendMailer } from "./mailer";

describe("mailer", () => {
  it("logs through the console mailer", async () => {
    const entries: string[] = [];
    const mailer = createConsoleMailer((entry) => entries.push(entry.subject));
    const result = await mailer.send({
      to: "ada@harbour.co",
      subject: "Receipt",
      text: "Paid",
      html: "<p>Paid</p>",
    });
    expect(result.provider).toBe("console");
    expect(entries).toEqual(["Receipt"]);
  });

  it("posts to Resend when a key is configured", async () => {
    let auth = "";
    const mailer = createResendMailer({
      apiKey: "re_test",
      from: "PayLink <receipts@example.com>",
      fetchImpl: (async (_url, init) => {
        auth = String((init?.headers as Record<string, string>).Authorization);
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
      }) as typeof fetch,
    });
    const result = await mailer.send({
      to: "ada@harbour.co",
      subject: "Receipt",
      text: "Paid",
      html: "<p>Paid</p>",
    });
    expect(result).toEqual({ provider: "resend", id: "email_1" });
    expect(auth).toBe("Bearer re_test");
  });
});
