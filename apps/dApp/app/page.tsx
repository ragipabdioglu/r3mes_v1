import { InferenceRuntimeHint } from "@/components/inference-runtime-hint";
import { MarketplaceList } from "@/components/marketplace-list";
import { PageIntro } from "@/components/page-intro";
import { R3mesBalanceCard } from "@/components/r3mes-balance";
import { pageIntro } from "@/lib/ui/product-copy";

export default function HomePage() {
  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <PageIntro title="Pazaryeri" description={pageIntro.home} />
        <InferenceRuntimeHint />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
            Behavior LoRA paketleri
          </h2>
          <MarketplaceList />
        </section>
        <aside className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
            Cüzdan
          </h2>
          <R3mesBalanceCard />
        </aside>
      </div>
    </div>
  );
}
