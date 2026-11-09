import { Connection, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { createTransfer } from "@solana/pay";
import BigNumber from "bignumber.js";
import { explorerTx, serverRpcUrl } from "../lib/env";
import { getDb } from "../lib/store";
import { keypairFrom, loadOrCreateKey, resetConnection } from "../lib/solana";
import { loadEnvFiles } from "./load-env";

loadEnvFiles();
resetConnection();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const db = getDb();
  const id = arg("--invoice") ?? arg("--id") ?? db.invoices.find((invoice) => invoice.status === "pending" && !invoice.sample)?.id;
  if (!id) throw new Error("Pass --invoice <id>. Create one in the chat first.");
  const invoice = db.invoices.find((item) => item.id === id);
  if (!invoice?.payment) throw new Error(`Invoice ${id} has no Solana Pay request.`);
  const amount = arg("--amount") ?? invoice.amount;
  const payer = keypairFrom(loadOrCreateKey("payer"));
  const connection = new Connection(serverRpcUrl(), "confirmed");
  const tx = await createTransfer(connection, payer.publicKey, {
    recipient: new PublicKey(invoice.payment.recipient),
    amount: new BigNumber(amount),
    splToken: new PublicKey(invoice.payment.asset),
    reference: new PublicKey(invoice.payment.reference),
    memo: invoice.id,
  });
  const signature = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
  console.log(`Sent ${amount} to ${invoice.number}`);
  console.log(explorerTx(signature));
  const origin = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  try {
    const response = await fetch(`${origin}/api/invoices/${invoice.id}/sync`, { method: "POST" });
    console.log(`Sync ${response.status}. Open ${origin}/invoices/${invoice.id}`);
  } catch {
    console.log("The app was not reachable. Open the invoice and it will pick up the transfer.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.message || error.name) : error);
  process.exit(1);
});
