import { Keypair, TransactionMessage, type VersionedTransactionResponse } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { transactionFeePayer } from "./transaction-payer";

describe("confirmed fee payer metadata", () => {
  it.each(["legacy", "v0"])("reads the static fee payer of a %s transaction", (version) => {
    const payer = Keypair.generate().publicKey;
    const builder = new TransactionMessage({ payerKey: payer, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [] });
    const tx: VersionedTransactionResponse = {
      slot: 1, meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
      transaction: { signatures: [], message: version === "legacy" ? builder.compileToLegacyMessage() : builder.compileToV0Message() },
    };
    expect(transactionFeePayer(tx)).toBe(payer.toBase58());
    tx.meta!.err = "AccountNotFound";
    expect(transactionFeePayer(tx)).toBeUndefined();
  });
  it("does not guess a payer for a missing transaction", () => {
    expect(transactionFeePayer(null)).toBeUndefined();
  });
});
