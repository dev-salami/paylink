import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { DEVNET_BUSY, friendlyPaymentError } from "./rpc-errors";

const mocks = vi.hoisted(() => ({ account: vi.fn(), mint: vi.fn(), transfer: vi.fn() }));
vi.mock("@solana/spl-token", async (importOriginal) => ({
  ...await importOriginal<typeof import("@solana/spl-token")>(),
  getAccount: mocks.account, getMint: mocks.mint,
}));
vi.mock("@solana/pay", async (importOriginal) => ({
  ...await importOriginal<typeof import("@solana/pay")>(), createTransfer: mocks.transfer,
}));

const address = Keypair.generate().publicKey.toBase58();
const input = { sender: address, recipient: address, amount: "10", splToken: address, reference: address, memo: "inv_test" };

beforeEach(() => {
  vi.stubEnv("SOLANA_RPC_URL", "http://127.0.0.1:8899");
  mocks.account.mockReset();
  mocks.mint.mockReset().mockResolvedValue({ decimals: 6 });
  mocks.transfer.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("payer token-account preflight", () => {
  it("does not misclassify transient ATA failures as a wallet with no USDC", async () => {
    mocks.account.mockRejectedValue(new Error("429 Too Many Requests"));
    const { buildPayTransaction } = await import("./solana");
    await expect(buildPayTransaction(input)).rejects.toThrow("429");
    expect(friendlyPaymentError("429 Too Many Requests")).toBe(DEVNET_BUSY);
    expect(mocks.transfer).not.toHaveBeenCalled();
  });
  it("handles genuinely missing or insufficient devnet USDC before building", async () => {
    const { buildPayTransaction } = await import("./solana");
    mocks.account.mockRejectedValueOnce(new Error("TokenAccountNotFoundError"));
    await expect(buildPayTransaction(input)).rejects.toThrow("TokenAccountNotFoundError");
    mocks.account.mockResolvedValueOnce({ amount: 0n });
    await expect(buildPayTransaction(input)).rejects.toThrow("no devnet USDC");
    mocks.account.mockResolvedValueOnce({ amount: 1_000_000n });
    await expect(buildPayTransaction(input)).rejects.toThrow("Insufficient devnet USDC");
    expect(mocks.transfer).not.toHaveBeenCalled();
  });
  it("preserves successful unsigned construction and retries a masked later sender lookup", async () => {
    mocks.account.mockResolvedValue({ amount: 20_000_000n });
    mocks.transfer.mockRejectedValueOnce(new Error("sender not found"));
    const { buildPayTransaction } = await import("./solana");
    await expect(buildPayTransaction(input)).rejects.toThrow(DEVNET_BUSY);
    const serialize = vi.fn(() => Buffer.from("unsigned-transaction"));
    mocks.transfer.mockResolvedValueOnce({ serialize });
    expect(await buildPayTransaction(input)).toBe(Buffer.from("unsigned-transaction").toString("base64"));
    expect(serialize).toHaveBeenCalledWith({ requireAllSignatures: false, verifySignatures: false });
  });
});
