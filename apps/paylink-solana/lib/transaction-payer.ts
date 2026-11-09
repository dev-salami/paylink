import type { VersionedTransactionResponse } from "@solana/web3.js";

/** This records the transaction fee payer, which may be a sponsor wallet. */
export function transactionFeePayer(tx: VersionedTransactionResponse | null): string | undefined {
  if (!tx?.meta || tx.meta.err || tx.transaction.message.header.numRequiredSignatures < 1) return undefined;
  const message = tx.transaction.message;
  // Fee payer is always a static key; v0 address-table resolution is unnecessary.
  return message.staticAccountKeys[0]?.toBase58();
}
