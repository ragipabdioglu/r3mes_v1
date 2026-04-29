import { InferenceRuntimeHint } from "@/components/inference-runtime-hint";
import { PageIntro } from "@/components/page-intro";
import { AdapterStatusBoard } from "@/components/studio/adapter-status-board";
import { KnowledgeStatusBoard } from "@/components/studio/knowledge-status-board";
import { KnowledgeUploadPanel } from "@/components/studio/knowledge-upload-panel";
import { StudioUploadPanel } from "@/components/studio-upload-panel";
import { knowledgeStudio, pageIntro } from "@/lib/ui/product-copy";

export default function StudioPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <PageIntro title="Studio" description={pageIntro.studio} />
        <InferenceRuntimeHint />
      </div>
      <KnowledgeStatusBoard />
      <section className="space-y-4 rounded-2xl border border-r3mes-border bg-r3mes-surface/30 p-5">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            {knowledgeStudio.statusBoardTitle}
          </h2>
          <p className="text-sm leading-relaxed text-zinc-500">
            {pageIntro.studio}
          </p>
        </div>
        <KnowledgeUploadPanel />
      </section>

      <section className="space-y-4 rounded-2xl border border-r3mes-border bg-r3mes-surface/20 p-5">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            {knowledgeStudio.behaviorSectionTitle}
          </h2>
          <p className="text-sm leading-relaxed text-zinc-500">
            {knowledgeStudio.behaviorSectionDescription}
          </p>
        </div>
        <AdapterStatusBoard />
        <div className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {knowledgeStudio.behaviorUploadTitle}
          </h3>
        </div>
        <StudioUploadPanel />
      </section>
    </div>
  );
}
