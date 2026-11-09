import type { InvoiceStatus, PaymentIssue } from "./types";
import { isPastDue } from "./dates";

export interface CreatePaymentInput {
  invoiceId: string;
  amount: string;
  currency: "USDC";
  label: string;
  message: string;
  memo: string;
}

export interface PaymentRequestResult {
  reference: string;
  url: string;
  recipient: string;
  asset: string;
  network: string;
}

export interface PaymentCheckInput {
  reference: string;
  amount: string;
  asset: string;
  recipient: string;
  dueDate: string;
}

export interface PaymentCheckResult {
  status: InvoiceStatus | "wrong_mint";
  signature?: string;
  explorerUrl?: string;
  amountReceived?: string;
  issue?: PaymentIssue;
  message?: string;
}

/**
 * A payment rail. Solana Pay implements this in the app.
 * PayPal and Airwallex entries should implement the same shape.
 */
export interface PaymentProvider {
  id: string;
  createRequest(input: CreatePaymentInput): Promise<PaymentRequestResult>;
  check(input: PaymentCheckInput): Promise<PaymentCheckResult>;
}

export interface ObservedTransfer {
  found: boolean;
  /** True when the observed amount is greater than or equal to the invoice. */
  amountOk?: boolean;
  /** True when the observed mint matches the invoice asset. */
  mintOk?: boolean;
  signature?: string;
  amountReceived?: string;
  rpcDown?: boolean;
  message?: string;
}

/**
 * Map an observed transfer onto an invoice status.
 * Wrong mint stays pending so the payer can still send the right token,
 * and the issue is surfaced separately.
 */
export function classifyInvoiceObservation(
  observed: ObservedTransfer,
  dueDate: string,
  now: Date,
): PaymentCheckResult {
  if (observed.rpcDown) {
    return {
      status: isPastDue(dueDate, now) ? "expired" : "pending",
      issue: "rpc_down",
      message: observed.message ?? "The Solana RPC could not be reached. Nothing was marked paid.",
    };
  }
  if (!observed.found) {
    if (isPastDue(dueDate, now)) {
      return { status: "expired", message: "Due date passed before a matching payment was found." };
    }
    return { status: "pending", message: "No matching transfer yet." };
  }
  if (observed.mintOk === false) {
    return {
      status: "pending",
      issue: "wrong_mint",
      signature: observed.signature,
      amountReceived: observed.amountReceived,
      message: observed.message ?? "A transfer used a different mint. This invoice accepts the configured USDC mint only.",
    };
  }
  if (observed.amountOk === false) {
    return {
      status: "underpaid",
      issue: "underpaid",
      signature: observed.signature,
      amountReceived: observed.amountReceived,
      message: observed.message ?? "The transfer is smaller than the invoice amount.",
    };
  }
  return {
    status: "paid",
    signature: observed.signature,
    amountReceived: observed.amountReceived,
    message: "Payment matches the amount and mint.",
  };
}

/**
 * Aurora Intents (or any later cross-chain deposit rail) plugs in here.
 * This submission does not call a provider. The pay page renders the slot only.
 */
export interface CrossChainDepositProvider {
  id: string;
  label: string;
  description: string;
  createDeposit?(input: { invoiceId: string; amount: string; asset: string }): Promise<{
    address: string;
    memo?: string;
    url?: string;
  }>;
}
