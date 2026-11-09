import { MAINNET_USDC_ASSET } from "../settlement/types";

export interface SourceAsset { assetId: string; chain: "base" | "arb" | "eth"; chainId: number; name: string; symbol: string; decimals: number; contract?: string }
const token = (chain: SourceAsset["chain"], chainId: number, name: string, symbol: string, decimals: number, contract?: string): SourceAsset => ({
  assetId: `nep141:${chain}${contract ? `-${contract}` : ""}.omft.near`, chain, chainId, name, symbol, decimals, contract,
});
export const SOURCES: SourceAsset[] = [
  token("base", 8453, "Base", "USDC", 6, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"), token("base", 8453, "Base", "ETH", 18),
  token("arb", 42161, "Arbitrum", "USDC", 6, "0xaf88d065e77c8cc2239327c5edb3a432268e5831"), token("arb", 42161, "Arbitrum", "ETH", 18),
  token("eth", 1, "Ethereum", "USDC", 6, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"), token("eth", 1, "Ethereum", "USDT", 6, "0xdac17f958d2ee523a2206206994597c13d831ec7"), token("eth", 1, "Ethereum", "ETH", 18),
];
export interface Token { assetId: string; decimals: number; blockchain: string }
export interface Incident { scopeType: "chain" | "token"; scopeValue: string; direction?: string }
export function sourceChainName(chain: string): string { return ({ base: "Base", arb: "Arbitrum", eth: "Ethereum" } as Record<string, string>)[chain] || chain; }
export function parseTokens(data: unknown): Token[] {
  const tokens = (data as { tokens?: unknown })?.tokens;
  if (!Array.isArray(tokens)) throw new Error("Available payment tokens could not be loaded.");
  return tokens.filter((item): item is Token => Boolean(item && typeof item.assetId === "string" && Number.isInteger(item.decimals) && typeof item.blockchain === "string"));
}
export function parseIncidents(data: unknown): Incident[] {
  const value = data as { status?: string; incidents?: Incident[] };
  if (!value || !["operational", "incidents"].includes(value.status || "") || !Array.isArray(value.incidents)) throw new Error("Payment availability could not be checked. Please try again later.");
  if (value.incidents.some((item) => !item || !["chain", "token"].includes(item.scopeType) || typeof item.scopeValue !== "string")) throw new Error("Payment availability could not be checked. Please try again later.");
  return value.incidents;
}
export function availableSources(tokens: Token[], incidents: Incident[]): SourceAsset[] {
  const aliases: Record<string, string[]> = { base: ["base"], arb: ["arb", "arbitrum"], eth: ["eth", "ethereum"], sol: ["sol", "solana"] };
  const blocked = (asset: string, chain: string) => incidents.some((item) => item.scopeType === "token" ? item.scopeValue === asset : aliases[chain]?.includes(item.scopeValue.toLowerCase()));
  if (!tokens.some((item) => item.assetId === MAINNET_USDC_ASSET && item.decimals === 6) || blocked(MAINNET_USDC_ASSET, "sol")) return [];
  return SOURCES.filter((source) => tokens.some((item) => item.assetId === source.assetId && item.decimals === source.decimals) && !blocked(source.assetId, source.chain));
}
export function originExplorer(chain: string, hash: string): string | undefined {
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) return undefined;
  const host = chain === "base" ? "basescan.org" : chain === "arb" ? "arbiscan.io" : chain === "eth" ? "etherscan.io" : undefined;
  return host ? `https://${host}/tx/${hash}` : undefined;
}
