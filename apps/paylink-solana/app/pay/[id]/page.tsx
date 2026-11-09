import Link from "next/link";
import { notFound } from "next/navigation";
import { PayClient } from "@/components/pay-client";
import { ThemeToggle } from "@/components/theme-toggle";
import { invoiceQr } from "@/lib/invoices";
import { getDb } from "@/lib/store";
import { friendlyInvoiceIssue } from "@/lib/rpc-errors";
import { resolveReceiptAmounts } from "@/lib/receipt-amounts";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = getDb().invoices.find((item) => item.id === id);
  if (!invoice) notFound();
  const qr = await invoiceQr(invoice);
  const merchant = getDb().merchant;
  return (
    <div className="pay-shell">
      <header className="pay-card mb-4 flex items-center justify-between">
        <Link href="/" className="display text-[1.45rem] font-medium">
          {merchant.name}
        </Link>
        <ThemeToggle />
      </header>
      <PayClient invoice={{ ...invoice, crossChain: resolveReceiptAmounts(invoice.id, invoice.crossChain, getDb().crossChainAttempts), paymentIssueDetail: invoice.paymentIssueDetail ? friendlyInvoiceIssue(invoice.paymentIssue, invoice.paymentIssueDetail) : undefined }} qr={qr} merchantName={merchant.name} />
      <p className="pay-card mt-4 text-center t-micro text-muted">{invoice.settlement?.mode === "live" ? "USDC on Solana mainnet · Real funds" : "Solana devnet · No monetary value · Do not send mainnet funds"}</p>
    </div>
  );
}
