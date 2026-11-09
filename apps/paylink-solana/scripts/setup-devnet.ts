import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { keypairFrom, loadOrCreateKey, resetConnection } from "../lib/solana";
import { loadEnvFiles } from "./load-env";
import { CIRCLE_DEVNET_USDC_MINT, serverRpcUrl } from "../lib/env";

loadEnvFiles();
resetConnection();

const mock = process.argv.includes("--mock-usdc");
const connection = new Connection(serverRpcUrl(), "confirmed");

async function airdrop(publicKey: PublicKey, label: string) {
  const balance = await connection.getBalance(publicKey);
  if (balance > 0.2 * LAMPORTS_PER_SOL) {
    console.log(`${label} already has ${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
    return;
  }
  try {
    const signature = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(signature, "confirmed");
    console.log(`Airdropped 1 SOL to ${label}: ${signature}`);
  } catch (error) {
    console.log(`Airdrop failed for ${label}. Request SOL at https://faucet.solana.com`);
    console.log(error instanceof Error ? error.message : error);
  }
}

async function main() {
  const names = ["merchant", "agent", "payer"] as const;
  const keys = names.map((name) => {
    const stored = loadOrCreateKey(name);
    console.log(`${name}: ${stored.publicKey}`);
    return stored;
  });
  for (const stored of keys) {
    await airdrop(new PublicKey(stored.publicKey), stored.name);
  }

  console.log("\nCircle devnet USDC mint:", CIRCLE_DEVNET_USDC_MINT);
  console.log("Faucet: https://faucet.circle.com — choose Solana devnet and paste each address.");

  if (!mock) {
    console.log("\nThe public devnet RPC often answers requestAirdrop with 410.");
    console.log("Fund each address at https://faucet.solana.com (or set HELIUS_API_KEY, whose devnet faucet still accepts requestAirdrop).");
    console.log("Pass --mock-usdc after the merchant has SOL if the Circle faucet is unavailable.");
    return;
  }

  const balance = await connection.getBalance(new PublicKey(keys[0].publicKey));
  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    console.log("\nThe merchant has no SOL, so a practice mint cannot be created yet.");
    console.log("Fund the merchant at https://faucet.solana.com, then run: pnpm devnet -- --mock-usdc");
    process.exitCode = 1;
    return;
  }

  const payer = keypairFrom(keys[0]);
  const mint = await createMint(connection, payer, payer.publicKey, null, 6);
  console.log("\nMock USDC mint:", mint.toBase58());
  for (const stored of keys) {
    const owner = keypairFrom(stored);
    const ata = await getOrCreateAssociatedTokenAccount(connection, payer, mint, owner.publicKey);
    await mintTo(connection, payer, mint, ata.address, payer, 1_000_000_000n);
    console.log(`Minted 1000 to ${stored.name} (${ata.address.toBase58()})`);
  }
  const out = path.join(process.cwd(), "data", "keys");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "mock-mint.json"), JSON.stringify({ mint: mint.toBase58() }, null, 2));
  console.log(`\nSet USDC_MINT=${mint.toBase58()} in .env.local and restart the app.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
