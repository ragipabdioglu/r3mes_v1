import { InferenceRuntimeHint } from "@/components/inference-runtime-hint";
import { PageIntro } from "@/components/page-intro";
import { FeedbackLearningBoard } from "@/components/studio/feedback-learning-board";
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
      <FeedbackLearningBoard />
      <section className="space-y-4 rounded-2xl border border-r3mes-border bg-r3mes-surface/30 p-5">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            {knowledgeStudio.uploadBoardTitle}
          </h2>
          <p className="text-sm leading-relaxed text-zinc-500">
            {pageIntro.studio}
          </p>
        </div>
        <KnowledgeUploadPanel />
      </section>

      <details className="group rounded-2xl border border-r3mes-border bg-r3mes-surface/20 p-5">
        <summary className="cursor-pointer list-none">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                {knowledgeStudio.behaviorSectionTitle}
              </h2>
              <p className="text-sm leading-relaxed text-zinc-500">
                {knowledgeStudio.behaviorSectionDescription}
              </p>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400 transition group-open:border-cyan-400/30 group-open:text-cyan-200">
              Gelismis
            </span>
          </div>
        </summary>
        <div className="mt-4 space-y-4">
          <AdapterStatusBoard />
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {knowledgeStudio.behaviorUploadTitle}
            </h3>
          </div>
          <StudioUploadPanel />
        </div>
      </details>
    </div>
  );
}
