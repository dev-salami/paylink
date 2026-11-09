import {
  createConsoleMailer,
  createResendMailer,
  formatLongDate,
  formatUsdc,
  type Invoice,
  type Mailer,
  type OutboundEmail,
  type Receipt,
} from "@181hacks/paylink-core";
import { env } from "./env";
import { validClientEmail } from "./invoice-interpreter";
import { getDb, updateDb } from "./store";

export function getMailer(): Mailer {
  const apiKey = env("RESEND_API_KEY");
  const from = env("RESEND_FROM", "PayLink <receipts@example.com>");
  if (!apiKey) return createConsoleMailer(() => undefined);
  return createResendMailer({ apiKey, from });
}

export function resendAlreadyDelivered(invoiceId: string, subjectPrefix: string): boolean {
  return getDb().emails.some(
    (item) => item.invoiceId === invoiceId && item.provider === "resend" && item.subject.startsWith(subjectPrefix),
  );
}

function recordUnsent(invoiceId: string | undefined, detail: string): void {
  updateDb((db) => {
    db.activities.unshift({
      id: `act_mail_${Date.now().toString(36)}`,
      at: new Date().toISOString(),
      kind: "note",
      title: "Email not sent",
      detail,
      invoiceId,
    });
  });
}

/**
 * Sends only through Resend when RESEND_API_KEY is set and the recipient is a
 * valid email. Otherwise records that nothing was delivered. Never claims a
 * console log was a sent email.
 */
export async function deliverEmail(
  email: OutboundEmail,
  invoiceId?: string,
): Promise<{ provider: string; id: string; delivered: boolean }> {
  const recipient = validClientEmail(email.to);
  if (!recipient) {
    recordUnsent(invoiceId, "The recipient is not a valid email address. Nothing was sent.");
    return { provider: "not-sent", id: "invalid-recipient", delivered: false };
  }
  const mailer = getMailer();
  if (mailer.id !== "resend") {
    recordUnsent(
      invoiceId,
      "RESEND_API_KEY is not set, so this message was not delivered. Set RESEND_API_KEY and RESEND_FROM on the server.",
    );
    return { provider: "not-sent", id: "unconfigured", delivered: false };
  }
  const prefix = email.subject.startsWith("Receipt ") ? "Receipt " : email.subject.startsWith("Reminder:") ? "Reminder:" : "";
  const claimId = `pending_${invoiceId ?? "mail"}_${prefix || "note"}`;
  if (invoiceId && prefix) {
    const gate = updateDb((db) => {
      const prior = db.emails.find(
        (item) => item.invoiceId === invoiceId && item.subject.startsWith(prefix) && (item.provider === "resend" || item.provider === "resend-pending"),
      );
      if (prior?.provider === "resend") return "sent" as const;
      if (prior) return "pending" as const;
      db.emails.unshift({
        id: claimId,
        at: new Date().toISOString(),
        to: recipient,
        subject: email.subject,
        text: email.text,
        html: email.html,
        provider: "resend-pending",
        invoiceId,
      });
      return "send" as const;
    });
    if (gate === "sent") return { provider: "resend", id: "already-sent", delivered: true };
    if (gate === "pending") return { provider: "not-sent", id: "in-progress", delivered: false };
  }
  let result: { provider: string; id: string };
  try {
    result = await mailer.send({ ...email, to: recipient });
  } catch (error) {
    updateDb((db) => {
      db.emails = db.emails.filter((item) => item.id !== claimId);
    });
    const status = error instanceof Error ? /Resend failed \((\d+)\)/.exec(error.message)?.[1] : undefined;
    throw new Error(status ? `Resend failed (${status}). Nothing was sent.` : "Email delivery failed. Nothing was sent.");
  }
  updateDb((db) => {
    const claim = db.emails.find((item) => item.id === claimId);
    if (claim) {
      claim.id = result.id;
      claim.provider = result.provider;
      claim.at = new Date().toISOString();
    } else {
      db.emails.unshift({
        id: result.id,
        at: new Date().toISOString(),
        to: recipient,
        subject: email.subject,
        text: email.text,
        html: email.html,
        provider: result.provider,
        invoiceId,
      });
    }
    db.activities.unshift({
      id: `act_${result.id}`,
      at: new Date().toISOString(),
      kind: "email_sent",
      title: email.subject,
      detail: `Resend → ${recipient}`,
      invoiceId,
    });
  });
  return { provider: result.provider, id: result.id, delivered: true };
}

export function receiptEmail(receipt: Receipt, payNote?: string, options?: { live?: boolean }): OutboundEmail | null {
  const to = validClientEmail(receipt.clientEmail);
  if (!to) return null;
  const merchant = getDb().merchant;
  const network = options?.live ? "Solana mainnet. Real USDC." : "Solana devnet. No monetary value.";
  const text = [
    `${receipt.clientName}, ${merchant.name} received your payment.`,
    `${formatUsdc(receipt.amount)} USDC for ${receipt.description}. ${network}`,
    receipt.txSignature ? `Transaction: ${receipt.explorerUrl}` : "Transaction link unavailable.",
    payNote ?? "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    to,
    subject: `Receipt ${receipt.number} from ${merchant.name}`,
    text,
    html: layout({
      eyebrow: "Receipt",
      title: `${formatUsdc(receipt.amount)} USDC received`,
      body: `<p>${escapeHtml(receipt.clientName)}, thank you. ${escapeHtml(merchant.name)} marked <strong>${escapeHtml(receipt.description)}</strong> as paid.</p>
        <p>Invoice ${escapeHtml(receipt.number)} · paid ${escapeHtml(formatLongDate(receipt.paidAt.slice(0, 10)))} · ${escapeHtml(network)}</p>
        ${receipt.explorerUrl ? `<p><a href="${escapeHtml(receipt.explorerUrl)}">View the Solana transaction</a></p>` : ""}`,
    }),
  };
}

export function reminderEmail(invoice: Invoice, origin: string): OutboundEmail | null {
  const to = validClientEmail(invoice.clientEmail);
  if (!to) return null;
  const merchant = getDb().merchant;
  const link = `${origin}/pay/${invoice.id}`;
  const text = `Hi ${invoice.clientName}, ${formatUsdc(invoice.amount)} USDC for ${invoice.description} is due ${formatLongDate(invoice.dueDate)}. Pay here: ${link}`;
  return {
    to,
    subject: `Reminder: ${invoice.number} is still open`,
    text,
    html: layout({
      eyebrow: "Reminder",
      title: `${formatUsdc(invoice.amount)} USDC is still open`,
      body: `<p>Hi ${escapeHtml(invoice.clientName)}, here is your outstanding invoice from ${escapeHtml(merchant.name)}.</p>
        <p>${escapeHtml(invoice.description)} · due ${escapeHtml(formatLongDate(invoice.dueDate))}</p>
        <p><a href="${escapeHtml(link)}">Pay ${escapeHtml(formatUsdc(invoice.amount))} USDC</a></p>`,
    }),
  };
}

function layout(input: { eyebrow: string; title: string; body: string }): string {
  return `<div style="font-family:Georgia,serif;background:#f3efe6;padding:32px;color:#1a1714">
    <div style="max-width:520px;margin:0 auto;background:#fffdf8;border-radius:18px;padding:32px">
      <p style="letter-spacing:.16em;text-transform:uppercase;font-family:Helvetica,sans-serif;font-size:11px;color:#0f6e56">${input.eyebrow}</p>
      <h1 style="font-weight:500;font-size:28px;margin:8px 0 16px">${input.title}</h1>
      <div style="font-size:16px;line-height:1.5">${input.body}</div>
    </div>
  </div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
