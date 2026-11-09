import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SOURCES } from "./aurora/assets";
import { depositPaymentUri } from "./aurora/payment-uri";

describe("MOCK payer funding instructions — no wallet or network calls", () => {
  const address = `0x${"2".repeat(40)}`;
  it("pins ERC-20 contracts/chain IDs and keeps exact integer amounts", () => {
    const base = SOURCES[0]!;
    expect(depositPaymentUri(base.assetId, address, "2020495")).toBe(`ethereum:${base.contract}@8453/transfer?address=${address}&uint256=2020495`);
    const arb = SOURCES[2]!;
    expect(depositPaymentUri(arb.assetId, address, "2000001")).toContain(`@42161/transfer?address=${address}&uint256=2000001`);
    expect(depositPaymentUri(SOURCES[1]!.assetId, address, "100000000000000001")).toBe(`ethereum:${address}@8453`);
  });
  it("never produces a misleading QR for an unsupported source, invalid amount/address or required memo", () => {
    expect(depositPaymentUri("nep141:fake.omft.near", address, "1")).toBeUndefined();
    expect(depositPaymentUri(SOURCES[0]!.assetId, "0x0", "1")).toBeUndefined();
    expect(depositPaymentUri(SOURCES[0]!.assetId, address, "1.1")).toBeUndefined();
    expect(depositPaymentUri(SOURCES[0]!.assetId, address, "1", "required memo")).toBeUndefined();
  });
  it("wires acknowledgements, resume, visibility polling and funding holds without mounting devnet wallet methods", () => {
    const payer = readFileSync(new URL("../components/live-payer.tsx", import.meta.url), "utf8");
    expect(payer).toContain("CrossChainPaymentPanel");
    expect(payer).not.toContain("useWallet"); expect(payer).not.toContain("ConnectionProvider");
    const panel = readFileSync(new URL("../components/cross-chain-payment.tsx", import.meta.url), "utf8");
    expect(panel).toContain("localStorage.getItem"); expect(payer).toContain("startPaymentResume");
    expect(panel).toContain("acknowledged"); expect(panel).toContain("paymentFundingAllowed");
    const resume = readFileSync(new URL("./payment-resume.ts", import.meta.url), "utf8");
    expect(resume).toContain("canDeposit === true"); expect(resume).toContain("confirmedId === attempt?.id");
    expect(panel).toContain("Confirm refund wallet and resume");
    expect(panel).toContain("userDeadline"); expect(panel).toContain("INCOMPLETE".toLowerCase());
    expect(panel).toContain("Do not send from an exchange");
  });
});
