import { ChatApp } from "@/components/chat-app";
import { Shell } from "@/components/shell";
import { shellData } from "@/components/shell-data";
import { modelConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ prompt?: string }> }) {
  const params = await searchParams;
  const prompt = (params.prompt ?? "").slice(0, 240);
  return (
    <Shell {...shellData()}>
      <ChatApp modelReady={modelConfigured()} initialPrompt={prompt} />
    </Shell>
  );
}
