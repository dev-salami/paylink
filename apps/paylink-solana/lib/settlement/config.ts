import { PublicKey } from "@solana/web3.js";
import { MAINNET_USDC_ASSET, MAINNET_USDC_MINT, decimalToAtomic, type Settlement } from "./types";

export function createSettlement(amount: string, input?: { mode?: string; recipient?: string }): Settlement {
  const amountAtomic = decimalToAtomic(amount, 6);
  if (!input || input.mode === "demo") return { mode: "demo" };
  if (BigInt(amountAtomic) > 18_446_744_073_709_551_615n) throw new Error("Amount exceeds the USDC token limit.");
  if (input.mode !== "live" || typeof input.recipient !== "string") throw new Error("Choose Solana devnet or enter a receiving wallet for Solana mainnet.");
  let recipient: PublicKey;
  try { recipient = new PublicKey(input.recipient.trim()); } catch { throw new Error("Use a valid mainnet Solana wallet address."); }
  if (!PublicKey.isOnCurve(recipient.toBytes())) throw new Error("Use a Solana wallet address, not a program address.");
  return { mode: "live", network: "solana-mainnet", chain: "sol", assetId: MAINNET_USDC_ASSET, mint: MAINNET_USDC_MINT, decimals: 6,
    recipient: recipient.toBase58(), amountAtomic, feePolicy: "payer_pays_exact_output" };
}
