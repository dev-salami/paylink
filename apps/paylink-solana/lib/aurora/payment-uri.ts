import { SOURCES } from "./assets";

/** EIP-681 is pinned to our allowlist, never a client-supplied chain/contract. */
export function depositPaymentUri(sourceAssetId: string, address: string, amountAtomic: string, memo?: string): string | undefined {
  const source = SOURCES.find((row) => row.assetId === sourceAssetId);
  if (!source || memo || !/^0x[a-fA-F0-9]{40}$/.test(address) || /^0x0{40}$/i.test(address) || !/^\d{1,100}$/.test(amountAtomic)) return undefined;
  const amount = BigInt(amountAtomic);
  if (amount <= 0n || amount > 2n ** 256n - 1n) return undefined;
  return source.contract ? `ethereum:${source.contract}@${source.chainId}/transfer?address=${address}&uint256=${amount}` : `ethereum:${address}@${source.chainId}`;
}
