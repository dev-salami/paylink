import { parseDueDate } from "./dates";

export type DemoIntent =
  | {
      type: "create_invoice";
      clientName: string;
      amount: string;
      description: string;
      dueDate: string;
      clientEmail?: string;
      asDraft: boolean;
    }
  | { type: "check_status"; query: string }
  | { type: "send_reminder"; query: string }
  | { type: "list_unpaid" }
  | { type: "generate_pdf"; query: string }
  | { type: "help" }
  | { type: "unknown"; hint: string };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function clean(value: string): string {
  return value.replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "").replace(/\s+/g, " ");
}

function subjectOf(text: string): string {
  const stripped = text
    .replace(/\b(please|send|make|generate|create|get|a|an|the|smart|branded|invoice|pdf|email|me|reminder|remind|chase|nudge|check|status|where|is|whats|what's)\b/gi, " ")
    .replace(/\b(to|for|of|on)\b/gi, " ");
  return titleCaseName(clean(stripped));
}

function titleCaseName(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseCreate(text: string, now: Date): DemoIntent | null {
  const match = text.match(/^(?:please\s+)?(?:draft\s+)?(?:invoice|bill|charge)\s+(.+)$/i);
  if (!match?.[1]) return null;
  const asDraft = /^\s*(?:please\s+)?draft\b/i.test(text);
  let rest = match[1];
  const emailMatch = rest.match(EMAIL);
  const clientEmail = emailMatch?.[0];
  if (clientEmail) rest = rest.replace(clientEmail, " ");
  const amountMatch = rest.match(/(\d+(?:\.\d{1,6})?)\s*(?:usdc|usd)?/i);
  const amount = amountMatch?.[1];
  if (!amountMatch || amountMatch.index === undefined || !amount) return null;
  const clientName = titleCaseName(clean(rest.slice(0, amountMatch.index)));
  if (!clientName) return null;
  let after = rest.slice(amountMatch.index + amountMatch[0].length);
  after = after.replace(/^\s*(?:usdc|usd)\b/i, "");
  let description = "Services";
  let duePhrase: string | undefined;
  const dueSplit = after.split(/\bdue\b/i);
  const beforeDue = dueSplit[0] ?? "";
  if (dueSplit.length > 1) duePhrase = clean(dueSplit.slice(1).join("due"));
  const forMatch = beforeDue.match(/\bfor\b\s+(.+)/i);
  if (forMatch?.[1]) description = clean(forMatch[1]);
  else if (clean(beforeDue)) description = clean(beforeDue);
  return {
    type: "create_invoice",
    clientName,
    amount,
    description: description || "Services",
    dueDate: parseDueDate(duePhrase, now),
    clientEmail,
    asDraft,
  };
}

/**
 * Rule-based parser used when no LLM key is configured.
 * Covers the demo sentence and the five agent tools.
 */
export function parseDemoCommand(text: string, now = new Date()): DemoIntent {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return { type: "unknown", hint: "Type an invoice, or ask what's unpaid." };

  const created = parseCreate(trimmed, now);
  if (created) return created;

  if (/\b(unpaid|outstanding|who owes|open invoices|what(?:'s| is) (?:still )?unpaid|list)\b/.test(lower)) {
    return { type: "list_unpaid" };
  }
  if (/\b(pdf|branded)\b/.test(lower)) {
    return { type: "generate_pdf", query: subjectOf(trimmed) };
  }
  if (/\b(remind|reminder|chase|nudge)\b/.test(lower)) {
    return { type: "send_reminder", query: subjectOf(trimmed) };
  }
  if (/\b(status|check|paid\??|where is)\b/.test(lower)) {
    return { type: "check_status", query: subjectOf(trimmed) };
  }
  if (/^(hi|hello|hey|help|what can you do)\b/.test(lower)) return { type: "help" };
  return {
    type: "unknown",
    hint: 'Try "invoice Ada 150 USDC for the logo, due Friday".',
  };
}
