export const AGENT_TOOL_NAMES = [
  "create_invoice",
  "check_status",
  "send_reminder",
  "list_unpaid",
  "generate_pdf",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export interface ToolDefinition {
  type: "function";
  function: {
    name: AgentToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "create_invoice",
      description: "Create a USDC invoice and a payment link for a client.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          clientName: { type: "string" },
          clientEmail: { type: "string" },
          amount: { type: "string", description: "Decimal USDC amount, such as 150 or 80.5" },
          description: { type: "string" },
          dueDate: { type: "string", description: "ISO date or a phrase like Friday or 12 Nov" },
          asDraft: { type: "boolean" },
        },
        required: ["clientName", "amount", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_status",
      description: "Look up one invoice by client name, invoice number, or id.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_unpaid",
      description: "List invoices that are still draft, pending, underpaid, or expired.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "send_reminder",
      description: "Send a smart reminder email. This is a paid x402 action.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { query: { type: "string", description: "Client name or invoice id" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_pdf",
      description: "Generate a branded PDF invoice. This is a paid x402 action.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
];

export const AGENT_SYSTEM_PROMPT = `You are PayLink, an invoicing agent for a freelance studio.
The merchant bills international clients in USDC. Turn plain sentences into tool calls.
Use create_invoice, check_status, list_unpaid, send_reminder, and generate_pdf.
Never invent a payment, a transaction signature, or a budget change.
Reminders and branded PDFs cost USDC from the agent wallet. The server enforces the budget.
If a detail is missing, ask one short question. Keep replies to a few sentences.
Do not mention internal provider names. Speak about the invoice, the pay link, and the receipt.`;
