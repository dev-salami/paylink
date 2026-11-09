import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const getOrCreate = vi.hoisted(() => vi.fn());
vi.mock("@solana/spl-token", async (importOriginal) => ({
  ...await importOriginal<typeof import("@solana/spl-token")>(),
  getOrCreateAssociatedTokenAccount: getOrCreate,
}));

const merchant = Keypair.generate();
const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

describe("ensureMerchantTokenAccount", () => {
  beforeEach(() => {
    vi.resetModules();
    getOrCreate.mockReset();
    process.env.MERCHANT_SECRET_KEY = bs58.encode(merchant.secretKey);
    process.env.SOLANA_RPC_URL = "http://127.0.0.1:8899";
  });

  it("creates the merchant's USDC account once, paid by the merchant", async () => {
    getOrCreate.mockResolvedValue({});
    const { ensureMerchantTokenAccount } = await import("./solana");
    await expect(ensureMerchantTokenAccount(MINT)).resolves.toBe(true);
    await ensureMerchantTokenAccount(MINT);
    expect(getOrCreate).toHaveBeenCalledTimes(1);
    const [, payer, mint, owner] = getOrCreate.mock.calls[0]!;
    expect(payer.publicKey.toBase58()).toBe(merchant.publicKey.toBase58());
    expect(mint.toBase58()).toBe(MINT);
    expect(owner.toBase58()).toBe(merchant.publicKey.toBase58());
  });

  it("does not throw when the RPC fails, and retries next time", async () => {
    getOrCreate.mockRejectedValueOnce(new Error("rpc down")).mockResolvedValue({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ensureMerchantTokenAccount } = await import("./solana");
    await expect(ensureMerchantTokenAccount(MINT)).resolves.toBe(false);
    await ensureMerchantTokenAccount(MINT);
    expect(getOrCreate).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
