export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailSendResult {
  provider: string;
  id: string;
}

export interface Mailer {
  id: string;
  send(email: OutboundEmail): Promise<MailSendResult>;
}

export function createConsoleMailer(log: (entry: OutboundEmail & MailSendResult) => void): Mailer {
  return {
    id: "console",
    async send(email) {
      const id = `log_${Math.random().toString(16).slice(2, 10)}`;
      log({ ...email, provider: "console", id });
      return { provider: "console", id };
    },
  };
}

export function createResendMailer(options: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): Mailer {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    id: "resend",
    async send(email) {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: options.from,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Resend failed (${response.status}): ${body.slice(0, 240)}`);
      }
      const json = (await response.json()) as { id?: string };
      return { provider: "resend", id: json.id ?? "resend" };
    },
  };
}
