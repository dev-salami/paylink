import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("payer RPC wiring", () => {
  it("keeps dedicated RPC URLs off the public page and browser provider", () => {
    const page = readFileSync(new URL("../app/pay/[id]/page.tsx", import.meta.url), "utf8");
    const client = readFileSync(new URL("../components/pay-client.tsx", import.meta.url), "utf8");
    expect(page).not.toContain("publicRpcUrl");
    expect(page).not.toContain("serverRpcUrl");
    expect(client).toContain("`${window.location.origin}/api/rpc`");
    expect(client).not.toContain("props.rpc");
    expect(client).not.toContain("api.devnet.solana.com");
    expect(client).toContain("friendlyInvoiceIssue(invoice.paymentIssue, invoice.paymentIssueDetail)");
    expect(client).toContain("prepareWalletTransaction");
  });
  it("contains mobile nav overflow within the header instead of clipping Wallet", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.k-tabs\s*\{[^}]*min-width: 0;[^}]*overflow-x: auto;/);
    expect(css).toMatch(/\.k-tab\s*\{[^}]*flex-shrink: 0;/);
    expect(css).toContain("flex: 0 0 100%");
  });
});
