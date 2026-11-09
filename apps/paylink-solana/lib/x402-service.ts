import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { x402Facilitator } from "@x402/core/facilitator";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import type { SupportedResponse } from "@x402/core/types";
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { ExactSvmScheme as ExactSvmClient } from "@x402/svm/exact/client";
import { registerExactSvmScheme as registerFacilitatorScheme } from "@x402/svm/exact/facilitator";
import { registerExactSvmScheme as registerServerScheme } from "@x402/svm/exact/server";
import { toFacilitatorSvmSigner } from "@x402/svm";
import {
  createId,
  executeX402Attempt,
  fromAtomic,
  toAtomic,
  type X402ExecutionResult,
  type X402TraceStep,
} from "@181hacks/paylink-core";
import {
  appOrigin,
  explorerTx,
  quoteTtlSeconds,
  resourcePrice,
  serverRpcUrl,
  SOLANA_DEVNET_CAIP2,
  usdcMint,
} from "./env";
import { buildInvoicePdf } from "./pdf";
import { deliverEmail, reminderEmail, resendAlreadyDelivered } from "./mail";
import { ensureMerchantTokenAccount, keypairFrom, loadOrCreateKey } from "./solana";
import { getDb, spentAtomic, updateDb } from "./store";
import type { Invoice, PaidResource, StoredQuote } from "@181hacks/paylink-core";

interface X402Runtime {
  resource: x402ResourceServer;
  merchant: string;
  mint: string;
}

let runtimePromise: Promise<X402Runtime> | null = null;

export function getX402Runtime(): Promise<X402Runtime> {
  if (!runtimePromise) runtimePromise = bootX402();
  return runtimePromise;
}

async function bootX402(): Promise<X402Runtime> {
  const merchant = keypairFrom(loadOrCreateKey("merchant"));
  const signer = await createKeyPairSignerFromBytes(merchant.secretKey);
  const facilitatorSigner = toFacilitatorSvmSigner(signer, { defaultRpcUrl: serverRpcUrl() });
  const facilitator = new x402Facilitator();
  registerFacilitatorScheme(facilitator, {
    signer: facilitatorSigner,
    networks: SOLANA_DEVNET_CAIP2,
  });
  const remoteUrl = process.env.X402_FACILITATOR_URL?.trim();
  const client: FacilitatorClient = remoteUrl
    ? await preferRemoteFacilitator(remoteUrl, facilitator)
    : localFacilitatorClient(facilitator);
  const resource = new x402ResourceServer(client);
  registerServerScheme(resource, { rpcUrl: serverRpcUrl() });
  await resource.initialize();
  return { resource, merchant: merchant.publicKey.toBase58(), mint: usdcMint() };
}

function localFacilitatorClient(facilitator: x402Facilitator): FacilitatorClient {
  return {
    verify: (payload, requirements) => facilitator.verify(payload, requirements),
    settle: (payload, requirements) => facilitator.settle(payload, requirements),
    getSupported: async () => facilitator.getSupported() as unknown as SupportedResponse,
  };
}

async function preferRemoteFacilitator(url: string, local: x402Facilitator): Promise<FacilitatorClient> {
  const { HTTPFacilitatorClient } = await import("@x402/core/server");
  const remote = new HTTPFacilitatorClient({ url, timeoutMs: 8_000 });
  try {
    const supported = await remote.getSupported();
    const knowsDevnet = supported.kinds.some((kind) => String(kind.network).includes("EtWTRABZaYq6iMfeYKouRu166VU2xqa1"));
    if (!knowsDevnet) return localFacilitatorClient(local);
    return {
      verify: (payload, requirements) => remote.verify(payload, requirements),
      settle: async (payload, requirements) => {
        try {
          return await remote.settle(payload, requirements);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "remote settle failed";
          if (/fetch|timeout|network|503|ECONN/i.test(reason)) {
            return local.settle(payload, requirements);
          }
          throw error;
        }
      },
      getSupported: () => remote.getSupported(),
    };
  } catch {
    return localFacilitatorClient(local);
  }
}

export interface Challenge {
  quote: StoredQuote;
  paymentRequired: PaymentRequired;
  header: string;
  steps: X402TraceStep[];
  merchantAccountReady: boolean;
}

export async function issueChallenge(input: {
  resourceName: PaidResource;
  invoice: Invoice;
  origin?: string;
}): Promise<Challenge> {
  const runtime = await getX402Runtime();
  const merchantAccountReady = await ensureMerchantTokenAccount(runtime.mint);
  const amount = resourcePrice(input.resourceName);
  const atomic = toAtomic(amount);
  const quoteId = createId("q");
  const origin = input.origin ?? appOrigin();
  const description =
    input.resourceName === "pdf"
      ? `Branded PDF for ${input.invoice.number}`
      : `Smart reminder for ${input.invoice.number}`;
  const url = `${origin}/api/x402/${input.resourceName}?invoice=${input.invoice.id}`;
  const requirements = await runtime.resource.buildPaymentRequirements({
    scheme: "exact",
    payTo: runtime.merchant,
    price: { asset: runtime.mint, amount: atomic.toString() },
    network: SOLANA_DEVNET_CAIP2,
    maxTimeoutSeconds: 90,
    extra: { memo: quoteId },
  });
  const paymentRequired = await runtime.resource.createPaymentRequiredResponse(requirements, {
    url,
    description,
    mimeType: input.resourceName === "pdf" ? "application/pdf" : "application/json",
  });
  const quote: StoredQuote = {
    id: quoteId,
    resource: input.resourceName,
    invoiceId: input.invoice.id,
    amount,
    amountAtomic: atomic.toString(),
    asset: requirements[0]?.asset ?? runtime.mint,
    payTo: requirements[0]?.payTo ?? runtime.merchant,
    network: SOLANA_DEVNET_CAIP2,
    memo: quoteId,
    expiresAt: new Date(Date.now() + quoteTtlSeconds() * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    paymentRequired: JSON.parse(
      JSON.stringify(paymentRequired, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
    ) as PaymentRequired,
  };
  updateDb((db) => {
    db.quotes.unshift(quote);
    db.activities.unshift({
      id: createId("act"),
      at: quote.createdAt,
      kind: "x402_request",
      title: `Payment requested for ${description}`,
      detail: `${amount} USDC on Solana devnet`,
      invoiceId: input.invoice.id,
      href: "/activity",
    });
  });
  return {
    quote,
    paymentRequired,
    header: encodePaymentRequiredHeader(paymentRequired),
    merchantAccountReady,
    steps: [
      {
        phase: "request",
        ok: false,
        httpStatus: 402,
        title: "Payment required",
        detail: `${description} costs ${amount} USDC. The agent wallet has not signed yet.`,
        body: paymentRequired,
      },
    ],
  };
}

export async function signChallenge(paymentRequired: PaymentRequired): Promise<string> {
  const agent = keypairFrom(loadOrCreateKey("agent"));
  const signer = await createKeyPairSignerFromBytes(agent.secretKey);
  const client = new x402Client();
  client.register(SOLANA_DEVNET_CAIP2, new ExactSvmClient(signer, { rpcUrl: serverRpcUrl() }));
  const http = new x402HTTPClient(client);
  const payload = await http.createPaymentPayload(paymentRequired);
  const headers = http.encodePaymentSignatureHeader(payload);
  const signature = headers["PAYMENT-SIGNATURE"] || headers["payment-signature"];
  if (!signature) throw new Error("The wallet could not sign this payment. Please try again.");
  return signature;
}

export interface AcceptInput {
  paymentSignature: string;
  fault?: "facilitator" | "delivery" | null;
  origin?: string;
}

export interface AcceptResult {
  status: number;
  contentType: string;
  body: Buffer | unknown;
  headers: Record<string, string>;
  result: X402ExecutionResult;
  invoiceId?: string;
  resource?: PaidResource;
}

export async function acceptPayment(input: AcceptInput): Promise<AcceptResult> {
  const payload = decodePaymentSignatureHeader(input.paymentSignature);
  const memo = String(payload.accepted?.extra?.memo ?? "");
  const quote = getDb().quotes.find((item) => item.id === memo || item.memo === memo);
  if (!quote) {
    const missing = await executeX402Attempt({
      now: new Date(),
      quote: {
        id: "missing",
        resource: "pdf",
        amountAtomic: 1n,
        asset: "unknown",
        payTo: "unknown",
        network: SOLANA_DEVNET_CAIP2,
        memo: "missing",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      proof: {
        proofId: "missing",
        amountAtomic: 1n,
        asset: "unknown",
        payTo: "unknown",
        memo: "missing",
      },
    });
    return jsonResult(missing, 402);
  }
  const requirements = quoteRequirements(quote, payload);
  const proofId = memo || quote.id;
  const existing = getDb().settlements.find((item) => item.proofId === proofId);
  const runtime = input.fault === "facilitator" ? null : await getX402Runtime();
  let settledSignature = existing?.signature;
  const result = await executeX402Attempt({
    now: new Date(),
    quote: {
      id: quote.id,
      resource: quote.resource,
      invoiceId: quote.invoiceId,
      amountAtomic: BigInt(quote.amountAtomic),
      asset: quote.asset,
      payTo: quote.payTo,
      network: quote.network,
      memo: quote.memo,
      expiresAt: quote.expiresAt,
    },
    proof: {
      proofId,
      amountAtomic: BigInt(payload.accepted.amount),
      asset: payload.accepted.asset,
      payTo: payload.accepted.payTo,
      memo,
    },
    existing: existing
      ? {
          proofId: existing.proofId,
          quoteId: existing.quoteId,
          signature: existing.signature,
          charged: existing.charged,
          delivered: existing.delivered,
          pending: existing.pending,
          deliveryError: existing.deliveryError,
        }
      : undefined,
    facilitator: runtime
      ? {
          verify: async () => {
            try {
              const verified = await runtime.resource.verifyPayment(payload, requirements);
              if (!verified.isValid) {
                return { ok: false, reason: verified.invalidReason || verified.invalidMessage || "invalid" };
              }
              return { ok: true };
            } catch (error) {
              return { ok: false, down: true, reason: error instanceof Error ? error.message : "verify failed" };
            }
          },
          settle: async () => {
            try {
              const settled = await runtime.resource.settlePayment(payload, requirements);
              if (settled.transaction) settledSignature = settled.transaction;
              if (settled.success && settled.transaction) return { ok: true, signature: settled.transaction };
              if (settled.errorReason === "settlement_pending" && settled.transaction) {
                return { ok: false, pending: true, signature: settled.transaction, reason: settled.errorMessage };
              }
              return { ok: false, reason: settled.errorReason || settled.errorMessage || "settle failed" };
            } catch (error) {
              return { ok: false, down: true, reason: error instanceof Error ? error.message : "settle failed" };
            }
          },
        }
      : {
          verify: async () => ({ ok: false, down: true, reason: "Facilitator disabled for this attempt" }),
          settle: async () => ({ ok: false, down: true, reason: "Facilitator disabled for this attempt" }),
        },
    deliver: async () => {
      if (input.fault === "delivery") return { ok: false, error: "Delivery handler failed after settlement." };
      return deliverResource(quote, settledSignature);
    },
  });

  const signature = result.signature;
  if (result.settlement) {
    const alreadyCharged = Boolean(existing?.charged);
    updateDb((db) => {
      const index = db.settlements.findIndex((item) => item.proofId === proofId);
      const stored = {
        proofId,
        quoteId: quote.id,
        resource: quote.resource,
        invoiceId: quote.invoiceId,
        amount: quote.amount,
        asset: quote.asset,
        signature: result.settlement?.signature,
        explorerUrl: result.settlement?.signature ? explorerTx(result.settlement.signature) : undefined,
        charged: Boolean(result.settlement?.charged),
        delivered: Boolean(result.settlement?.delivered),
        pending: Boolean(result.settlement?.pending),
        deliveryError: result.settlement?.deliveryError,
        updatedAt: new Date().toISOString(),
      };
      if (index >= 0) db.settlements[index] = stored;
      else db.settlements.unshift(stored);
      if (result.delivered && alreadyCharged) {
        db.activities.unshift({
          id: createId("act"),
          at: new Date().toISOString(),
          kind: "x402_delivered",
          title: `${quote.resource === "pdf" ? "Invoice PDF" : "Reminder"} delivered on retry`,
          detail: "The original settlement was reused. Nothing else was charged.",
          invoiceId: quote.invoiceId,
          href: "/activity",
          txSignature: result.signature,
          explorerUrl: result.signature ? explorerTx(result.signature) : undefined,
        });
        const spend = db.spends.find((item) => item.signature === result.signature && item.invoiceId === quote.invoiceId);
        if (spend) spend.status = "settled";
      }
      if (result.charged && !alreadyCharged && result.settlement?.charged) {
        db.spends.unshift({
          id: createId("spd"),
          at: stored.updatedAt,
          resource: quote.resource,
          invoiceId: quote.invoiceId,
          amount: quote.amount,
          status: stored.delivered ? "settled" : stored.pending ? "pending_chain" : "delivery_failed",
          signature: stored.signature,
          explorerUrl: stored.explorerUrl,
          detail: stored.deliveryError,
        });
        db.activities.unshift({
          id: createId("act"),
          at: stored.updatedAt,
          kind: stored.delivered ? "x402_delivered" : "x402_settled",
          title: stored.delivered ? `${quote.resource === "pdf" ? "Invoice PDF" : "Reminder"} delivered` : `${quote.resource === "pdf" ? "Invoice PDF" : "Reminder"} paid, delivery pending`,
          detail: `${quote.amount} USDC · spent ${fromAtomic(spentAtomic(db))} of the budget`,
          invoiceId: quote.invoiceId,
          href: quote.resource === "pdf" && quote.invoiceId ? `/api/invoices/${quote.invoiceId}/pdf` : "/activity",
          txSignature: stored.signature,
          explorerUrl: stored.explorerUrl,
        });
      } else if (result.code && result.code !== "paid_delivery_failed") {
        db.activities.unshift({
          id: createId("act"),
          at: new Date().toISOString(),
          kind: "x402_failed",
          title: "Payment needs attention",
          detail: result.steps.at(-1)?.detail,
          invoiceId: quote.invoiceId,
          href: "/activity",
        });
      }
    });
  }

  if (result.delivered && quote.resource === "pdf" && quote.invoiceId) {
    const bytes = (await import("./pdf")).readStoredPdf(quote.invoiceId);
    if (bytes) {
      return {
        status: 200,
        contentType: "application/pdf",
        body: bytes,
        headers: responseHeaders(result, signature),
        result,
        invoiceId: quote.invoiceId,
        resource: quote.resource,
      };
    }
  }
  return {
    ...jsonResult(result, result.httpStatus, {
      invoiceId: quote.invoiceId,
      resource: quote.resource,
      download: quote.resource === "pdf" && quote.invoiceId ? `/api/invoices/${quote.invoiceId}/pdf` : undefined,
    }),
    invoiceId: quote.invoiceId,
    resource: quote.resource,
  };
}

async function deliverResource(quote: StoredQuote, signature?: string): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const invoice = db.invoices.find((item) => item.id === quote.invoiceId);
  if (!invoice) return { ok: false, error: "Invoice no longer exists." };
  try {
    if (quote.resource === "pdf") {
      await buildInvoicePdf({
        invoice,
        merchant: db.merchant,
        payUrl: invoice.payment?.url,
        settlementSignature: signature,
      });
      return { ok: true };
    }
    if (resendAlreadyDelivered(invoice.id, "Reminder:")) return { ok: true };
    const email = reminderEmail(invoice, appOrigin());
    if (!email) return { ok: false, error: "This invoice has no valid client email. Nothing was sent." };
    const sent = await deliverEmail(email, invoice.id);
    if (!sent.delivered) {
      return {
        ok: false,
        error: "Email is not configured, so the reminder was not sent. Set RESEND_API_KEY and RESEND_FROM. A retry uses the same payment and does not charge again.",
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Delivery failed" };
  }
}

function quoteRequirements(quote: StoredQuote, payload: PaymentPayload): PaymentRequirements {
  const stored = quote.paymentRequired as PaymentRequired | undefined;
  const accepts = stored?.accepts ?? [];
  return accepts.find((item) => item.amount === payload.accepted.amount && item.asset === payload.accepted.asset) ?? payload.accepted;
}

function responseHeaders(result: X402ExecutionResult, signature?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (signature || result.settlement?.signature) {
    const body: SettleResponse = {
      success: Boolean(result.delivered || result.charged),
      transaction: result.settlement?.signature || signature || "",
      network: SOLANA_DEVNET_CAIP2,
      errorReason: result.code,
      errorMessage: result.steps.at(-1)?.detail,
    };
    headers["PAYMENT-RESPONSE"] = encodePaymentResponseHeader(body);
  }
  return headers;
}

function jsonResult(result: X402ExecutionResult, status: number, extra?: Record<string, unknown>): AcceptResult {
  return {
    status,
    contentType: "application/json",
    body: {
      ...extra,
      code: result.code,
      charged: result.charged,
      delivered: result.delivered,
      pending: result.pending,
      signature: result.signature,
      explorerUrl: result.signature ? explorerTx(result.signature) : undefined,
      steps: result.steps,
    },
    headers: responseHeaders(result),
    result,
  };
}

export { paymentRequiredResponse } from "./x402-response";

export function toHttpResponse(result: AcceptResult): Response {
  const headers = new Headers(result.headers);
  headers.set("Cache-Control", "private, no-store");
  if (result.contentType === "application/pdf" && Buffer.isBuffer(result.body)) {
    headers.set("Content-Type", "application/pdf");
    return new Response(new Uint8Array(result.body), { status: result.status, headers });
  }
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(result.body), { status: result.status, headers });
}
