import { Suspense } from "react";

import { ChatScreen } from "@/components/chat-screen";
import { InferenceRuntimeHint } from "@/components/inference-runtime-hint";
import { PageIntro } from "@/components/page-intro";
import { loadingLabel, pageIntro } from "@/lib/ui/product-copy";

export default function ChatPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <PageIntro title="Chat" description={pageIntro.chat} />
        <InferenceRuntimeHint />
      </div>
      <Suspense
        fallback={
          <div className="text-sm text-zinc-500">{loadingLabel}</div>
        }
      >
        <ChatScreen />
      </Suspense>
    </div>
  );
}
