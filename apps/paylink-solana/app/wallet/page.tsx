import { Shell } from "@/components/shell";
import { shellData } from "@/components/shell-data";
import { WalletPanel } from "@/components/wallet-panel";
import { explorerAddress, usdcMint } from "@/lib/env";
import { loadOrCreateKey } from "@/lib/solana";
import { currentBudgetView, getDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function WalletPage() {
  const agent = loadOrCreateKey("agent");
  const merchant = loadOrCreateKey("merchant");
  return (
    <Shell {...shellData()}>
      <WalletPanel
        budget={currentBudgetView()}
        spends={getDb().spends.filter((spend) => !spend.sample)}
        agent={agent.publicKey}
        merchant={merchant.publicKey}
        mint={usdcMint()}
        agentUrl={explorerAddress(agent.publicKey)}
        merchantUrl={explorerAddress(merchant.publicKey)}
      />
    </Shell>
  );
}
