import {
  evaluateAgentSpend,
  formatLongDate,
  formatUsdc,
  parseDemoCommand,
  toAtomic,
  type BudgetView,
  type DemoIntent,
  reminderRefusal,
  type Invoice,
  type X402TraceStep,
} from "@181hacks/paylink-core";
import { env, modelConfigured, resourcePrice } from "./env";
import { findInvoice, issueInvoice, unpaidInvoices } from "./invoices";
import { acceptPayment, issueChallenge, signChallenge } from "./x402-service";
import { budgetPolicy, currentBudgetView, getDb, spentAtomic } from "./store";
import { invoiceStatusCopy } from "./product-copy";
import { createSettlement } from "./settlement/config";
import {
  messageTooLong,
  MISSING_MODEL_REPLY,
  requestInterpretation,
  reviewExtraction,
  UNAVAILABLE_MODEL_REPLY,
  validClientEmail,
  type PendingDraftContext,
} from "./invoice-interpreter";
import {
  cancelInvoicePreview,
  confirmInvoicePreview,
  getInvoicePreview,
  saveInvoicePreview,
  type InvoicePreview,
} from "./invoice-preview";

export interface ChatRequest {
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
  approval?: { resource: "pdf" | "reminder"; invoiceId: string };
  settlement?: { mode?: string; recipient?: string };
  confirmPreview?: { previewId: string };
  cancelPreview?: { previewId: string };
  activePreviewId?: string;
}

export interface ChatResponse {
  reply: string;
  mode: "demo" | "llm";
  invoice?: Invoice;
  invoices?: Invoice[];
  steps?: X402TraceStep[];
  outcome?: string;
  download?: string;
  invoicePreview?: InvoicePreview;
  approval?: {
    resource: "pdf" | "reminder";
    invoiceId: string;
    amount: string;
    clientName: string;
    summary: string;
    paymentRequired: unknown;
  };
  budget: BudgetView;
}

export async function runChat(request: ChatRequest, origin: string): Promise<ChatResponse> {
  const mode = modelConfigured() ? "llm" : "demo";
  if (request.approval) {
    return payFor(request.approval.resource, request.approval.invoiceId, true, origin, mode);
  }
  if (request.confirmPreview?.previewId) return confirmDraft(request.confirmPreview.previewId, mode);
  if (request.cancelPreview?.previewId) return cancelDraft(request.cancelPreview.previewId, mode);
  if (!modelConfigured()) {
    const intent = parseDemoCommand(request.message);
    if (intent.type === "unknown") return { mode, budget: currentBudgetView(), reply: MISSING_MODEL_REPLY };
    return act(intent, mode, origin, request.settlement);
  }
  return interpretAndAct(request, origin, mode);
}

async function act(intent: DemoIntent, mode: "demo" | "llm", origin: string, settlement?: ChatRequest["settlement"]): Promise<ChatResponse> {
  const budget = currentBudgetView();
  if (intent.type === "help") {
    return {
      mode,
      budget,
      reply:
        "I can prepare a USDC invoice, list what's unpaid, check an invoice, or request a reminder or branded PDF. A reminder or PDF is paid from the agent wallet on Solana devnet.",
    };
  }
  if (intent.type === "unknown") {
    return { mode, budget, reply: intent.hint };
  }
  if (intent.type === "list_unpaid") {
    const invoices = unpaidInvoices().filter((invoice) => !invoice.sample);
    if (invoices.length === 0) {
      return { mode, budget, invoices, reply: "No outstanding invoices." };
    }
    const lines = invoices.map((invoice) => `${invoice.clientName} · ${formatUsdc(invoice.amount)} USDC · ${invoiceStatusCopy[invoice.status]}`).join("\n");
    return {
      mode,
      budget,
      invoices,
      reply: `${invoices.length} open ${invoices.length === 1 ? "invoice" : "invoices"}:\n${lines}`,
    };
  }
  if (intent.type === "create_invoice") {
    const invoice = await issueInvoice({ ...intent, settlement });
    return {
      mode,
      budget: currentBudgetView(),
      invoice,
      reply: intent.asDraft
        ? `Draft ${invoice.number} is saved for ${invoice.clientName}. It does not have a pay link until you issue it.`
        : invoice.settlement?.mode === "live" ? `Invoice ${invoice.number} is live for ${invoice.clientName}. Receive ${invoice.amount} USDC on Solana mainnet. Payments use real funds. Your client can choose from the tokens and networks shown on the payment page.`
        : `Invoice ${invoice.number} is live for ${invoice.clientName}. ${formatUsdc(invoice.amount)} USDC for ${invoice.description}, due ${formatLongDate(invoice.dueDate)}. Solana devnet only; no monetary value. Share the payment link with your client.`,
    };
  }
  if (intent.type === "check_status") {
    const invoice = findInvoice(intent.query);
    if (!invoice) return { mode, budget, reply: `I couldn't find an invoice matching “${intent.query}”.` };
    return {
      mode,
      budget,
      invoice,
      reply: `${invoice.number} for ${invoice.clientName}: ${invoiceStatusCopy[invoice.status]}. ${formatUsdc(invoice.amount)} USDC for ${invoice.description}, due ${formatLongDate(invoice.dueDate)}.${invoice.explorerUrl ? ` Transaction: ${invoice.explorerUrl}` : ""}`,
    };
  }
  const query = intent.type === "send_reminder" || intent.type === "generate_pdf" ? intent.query : "";
  const invoice = findInvoice(query);
  if (!invoice) {
    return { mode, budget, reply: query ? `I couldn't find “${query}”.` : "Which invoice should I use?" };
  }
  return payFor(intent.type === "generate_pdf" ? "pdf" : "reminder", invoice.id, false, origin, mode);
}

async function payFor(
  resource: "pdf" | "reminder",
  invoiceId: string,
  approved: boolean,
  origin: string,
  mode: "demo" | "llm",
): Promise<ChatResponse> {
  const invoice = getDb().invoices.find((item) => item.id === invoiceId);
  const budget = currentBudgetView();
  if (!invoice) return { mode, budget, reply: "Invoice not found. Check the invoice number." };
  if (invoice.sample) {
    return {
      mode,
      budget,
      outcome: "refused",
      reply: `${invoice.number} is a development fixture. I didn't request payment or send anything.`,
    };
  }
  const refusal = resource === "reminder" ? reminderRefusal(invoice) : null;
  if (refusal) {
    return {
      mode,
      budget,
      invoice,
      outcome: "refused",
      steps: [{ phase: "policy", ok: false, title: "Reminder not needed", detail: `${refusal} No payment was made.` }],
      reply: `${refusal} I didn't spend anything.`,
    };
  }
  if (resource === "reminder" && !validClientEmail(invoice.clientEmail)) {
    return {
      mode,
      budget,
      invoice,
      outcome: "refused",
      reply: "This invoice has no valid client email, so I didn't request payment or send a reminder.",
    };
  }
  if (resource === "reminder" && !env("RESEND_API_KEY")) {
    return {
      mode,
      budget,
      invoice,
      outcome: "refused",
      reply: "RESEND_API_KEY is not set, so I didn't request payment or send a reminder. Nothing was charged.",
    };
  }
  const price = resourcePrice(resource);
  const decision = evaluateAgentSpend(budgetPolicy(), spentAtomic(), toAtomic(price), approved);
  const mustConfirmReminder = resource === "reminder" && !approved;
  const label = resource === "pdf" ? "branded PDF" : "payment reminder";

  if (!decision.ok && decision.code !== "needs_approval") {
    return {
      mode,
      budget,
      invoice,
      outcome: decision.code,
      steps: [
        {
          phase: "policy",
          ok: false,
          code: decision.code,
          title: decision.code === "over_cap" ? "Over the per-call cap" : "Insufficient budget",
          detail: decision.detail,
        },
      ],
      reply: decision.detail,
    };
  }

  const challenge = await issueChallenge({ resourceName: resource, invoice, origin });
  if (!challenge.merchantAccountReady) {
    const detail = "The merchant USDC account is not on devnet yet. A little SOL in the merchant wallet lets PayLink create it. Nothing was charged.";
    return {
      mode,
      budget,
      invoice,
      steps: [
        ...challenge.steps,
        { phase: "policy", ok: false, code: "facilitator_down", title: "Merchant USDC account missing", detail },
      ],
      outcome: "facilitator_down",
      reply: `I couldn't pay for the ${label}. ${detail}`,
    };
  }
  if (mustConfirmReminder || (!decision.ok && decision.code === "needs_approval")) {
    return {
      mode,
      budget,
      invoice,
      steps: challenge.steps,
      outcome: "needs_approval",
      approval: {
        resource,
        invoiceId: invoice.id,
        amount: price,
        clientName: invoice.clientName,
        summary: decision.detail,
        paymentRequired: challenge.paymentRequired,
      },
      reply:
        resource === "reminder"
          ? `A reminder for ${invoice.clientName} costs ${price} USDC from the agent wallet on Solana devnet. Confirming pays that amount and emails ${invoice.clientEmail}. Nothing is sent until you confirm. ${decision.detail}`
          : `A ${label} for ${invoice.clientName} costs ${price} USDC from the agent wallet. ${decision.detail}`,
    };
  }

  try {
    const header = await signChallenge(challenge.paymentRequired);
    const paid = await acceptPayment({ paymentSignature: header, origin });
    const steps = [...challenge.steps, ...paid.result.steps.filter((step) => step.phase !== "request")];
    const download = resource === "pdf" ? `/api/invoices/${invoice.id}/pdf` : undefined;
    return {
      mode,
      budget: currentBudgetView(),
      invoice,
      steps,
      outcome: paid.result.code ?? (paid.result.delivered ? "delivered" : "settled"),
      download: paid.result.delivered ? download : undefined,
      reply: replyForPayment(
        label,
        invoice,
        paid.result.delivered,
        paid.result.code,
        paid.result.signature,
        paid.result.steps.at(-1)?.detail,
      ),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The agent wallet could not sign.";
    return {
      mode,
      budget: currentBudgetView(),
      invoice,
      steps: [
        ...challenge.steps,
        { phase: "settle", ok: false, code: "facilitator_down", title: "Payment connection unavailable", detail },
      ],
      outcome: "facilitator_down",
      reply: `The wallet could not approve the payment. ${detail} No spending was recorded.`,
    };
  }
}

function replyForPayment(
  label: string,
  invoice: Invoice,
  delivered: boolean,
  code?: string,
  signature?: string,
  detail?: string,
): string {
  if (delivered) {
    return signature
      ? `The ${label} for ${invoice.number} is ready. Devnet transaction: ${signature}.`
      : `The ${label} for ${invoice.number} is ready.`;
  }
  if (code === "paid_delivery_failed") {
    return `USDC moved for the ${label}, but delivery failed. Retry uses the same proof and will not charge again.`;
  }
  if (code === "facilitator_down") {
    return `Payment confirmation is incomplete. No second charge was made. ${detail ?? ""}`.trim();
  }
  return `The ${label} did not complete. ${detail ?? "The budget was left untouched."}`;
}

function pendingContext(id: string | undefined): PendingDraftContext | null {
  if (!id) return null;
  const preview = getInvoicePreview(id);
  if (!preview || preview.status !== "open" || preview.invoiceId || preview.expiresAt <= Date.now()) return null;
  return {
    description: preview.description,
    amount: preview.amount,
    clientName: preview.clientName,
    clientEmail: preview.clientEmail,
    dueDate: preview.dueDate,
  };
}

function settlementSnapshot(input: ChatRequest["settlement"], amount: string): { mode: "demo" | "live"; recipient?: string } | { error: string } {
  try {
    const settled = createSettlement(amount, input?.mode === "live" ? { mode: "live", recipient: input.recipient } : { mode: "demo" });
    if (settled.mode === "live") return { mode: "live", recipient: settled.recipient };
    return { mode: "demo" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Choose Solana devnet or enter a receiving wallet for Solana mainnet." };
  }
}

async function interpretAndAct(request: ChatRequest, origin: string, mode: "demo" | "llm"): Promise<ChatResponse> {
  const budget = currentBudgetView();
  const message = request.message.trim();
  if (!message) return { mode, budget, reply: "Tell me the work and the amount. Nothing was created." };
  if (messageTooLong(message)) {
    return { mode, budget, reply: "That message is too long. Send the invoice in one shorter sentence. Nothing was created." };
  }
  const interpreted = await requestInterpretation(
    { message, history: request.history, pending: pendingContext(request.activePreviewId) },
    {
      apiKey: env("LLM_API_KEY"),
      baseUrl: env("LLM_BASE_URL", "https://api.openai.com/v1"),
      model: env("LLM_MODEL", "gpt-4o-mini"),
    },
  );
  if (!interpreted.ok) return { mode, budget, reply: UNAVAILABLE_MODEL_REPLY };
  const wantsLive = request.settlement?.mode === "live";
  const review = reviewExtraction(interpreted.extraction, {
    settlementMode: wantsLive ? "live" : "demo",
    recipient: request.settlement?.recipient?.trim(),
  });
  if (review.type === "followup" || review.type === "unrelated") return { mode, budget, reply: review.reply };
  if (review.type === "preview") {
    const checked = settlementSnapshot(request.settlement, review.preview.amount);
    if ("error" in checked) return { mode, budget, reply: `${checked.error} Nothing was created.` };
    if (checked.mode === "live") {
      if (!checked.recipient) return { mode, budget, reply: "Enter a receiving wallet for Solana mainnet. Nothing was created." };
      review.preview.settlement = { mode: "live", recipient: checked.recipient };
      review.preview.network = "mainnet";
      review.preview.networkLabel = `Solana mainnet · real USDC to ${checked.recipient}. This is the wallet you entered. The assistant did not choose it.`;
    } else {
      review.preview.settlement = { mode: "demo" };
      review.preview.network = "devnet";
    }
    const saved = saveInvoicePreview(review.preview);
    return { mode, budget, reply: review.reply, invoicePreview: saved };
  }
  const intent: DemoIntent =
    review.type === "list_unpaid"
      ? { type: "list_unpaid" }
      : review.type === "check_status"
        ? { type: "check_status", query: review.query }
        : review.type === "send_reminder"
          ? { type: "send_reminder", query: review.query }
          : { type: "generate_pdf", query: review.query };
  return act(intent, mode, origin, request.settlement);
}

async function confirmDraft(previewId: string, mode: "demo" | "llm"): Promise<ChatResponse> {
  const budget = currentBudgetView();
  try {
    const result = await confirmInvoicePreview(previewId, async (preview) => {
      const invoice = await issueInvoice({
        clientName: preview.clientName ?? "Unnamed client",
        clientEmail: preview.clientEmail,
        description: preview.description,
        amount: preview.amount,
        dueDate: preview.dueDate,
        asDraft: true,
        settlement: preview.settlement,
      });
      return invoice.id;
    });
    if ("error" in result) {
      const reply =
        result.error === "superseded"
          ? "That review was replaced. Confirm the latest one. Nothing new was created."
          : result.error === "expired"
            ? "That review expired. Ask again and I'll prepare a new one. Nothing was created."
            : "That review is no longer open. Nothing was created.";
      return { mode, budget, reply };
    }
    const invoice = getDb().invoices.find((item) => item.id === result.invoiceId);
    return {
      mode,
      budget: currentBudgetView(),
      invoice,
      reply: result.created
        ? `Draft ${invoice?.number ?? ""} is saved${invoice ? ` for ${invoice.clientName}` : ""}. It has no pay link until you issue it, and no email was sent.`
        : `Draft ${invoice?.number ?? result.invoiceId} was already saved. I didn't create another.`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The draft could not be saved.";
    return { mode, budget: currentBudgetView(), reply: `${detail} Nothing else was created.` };
  }
}

function cancelDraft(previewId: string, mode: "demo" | "llm"): ChatResponse {
  cancelInvoicePreview(previewId);
  return { mode, budget: currentBudgetView(), reply: "Cancelled. Nothing was created." };
}
