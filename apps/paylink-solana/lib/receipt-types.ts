import type { SettlementInvoice, SettlementReceipt } from "./settlement/types";

/** Optional local metadata; older stores remain valid and core stays rail-agnostic. */
export type SolanaInvoice = SettlementInvoice & { payerWallet?: string };
export type SolanaReceipt = SettlementReceipt & { payerWallet?: string };
