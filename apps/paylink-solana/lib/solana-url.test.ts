import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { solanaPayUrl } from "./solana";

describe("solanaPayUrl", () => {
  it("builds a devnet USDC transfer request with a unique reference", () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const reference = Keypair.generate().publicKey.toBase58();
    const mint = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
    const url = solanaPayUrl({
      recipient,
      amount: "150",
      splToken: mint,
      reference,
      label: "Morrow Quay Studio",
      message: "the logo",
      memo: "inv_ada",
    });
    const parsed = new URL(url);
    expect(parsed.protocol).toBe("solana:");
    expect(parsed.pathname).toBe(recipient);
    expect(parsed.searchParams.get("amount")).toBe("150");
    expect(parsed.searchParams.get("spl-token")).toBe(mint);
    expect(parsed.searchParams.get("reference")).toBe(reference);
    expect(parsed.searchParams.get("memo")).toBe("inv_ada");
  });
});
