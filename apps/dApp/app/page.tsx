import { InferenceRuntimeHint } from "@/components/inference-runtime-hint";
import { MarketplaceList } from "@/components/marketplace-list";
import { PageIntro } from "@/components/page-intro";
import { R3mesBalanceCard } from "@/components/r3mes-balance";
import { pageIntro } from "@/lib/ui/product-copy";
import Link from "next/link";

const readinessCards = [
  {
    label: "Knowledge",
    value: "Auto RAG",
    detail: "Private/public collection, profile ve kaynak secimi ana akista.",
  },
  {
    label: "Retrieval",
    value: "Hybrid",
    detail: "Qdrant semantic adaylar, lexical destek ve reranker ile temizlenir.",
  },
  {
    label: "Model",
    value: "Qwen2.5-3B",
    detail: "Temiz evidence geldikten sonra yalniz sentez gorevi ustlenir.",
  },
];

const quickActions = [
  {
    href: "/studio",
    title: "Knowledge yukle",
    description: "Veriyi private olarak ekle, hazir olunca public yayinla.",
  },
  {
    href: "/chat",
    title: "Auto source ile sor",
    description: "Kaynak secmeden basla; sistem uygun collection onerir.",
  },
];

export default function HomePage() {
  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <PageIntro title="Dashboard" description={pageIntro.home} />
        <InferenceRuntimeHint />
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {readinessCards.map((card) => (
          <article
            key={card.label}
            className="rounded-2xl border border-r3mes-border bg-r3mes-surface/55 p-5 shadow-2xl shadow-black/10"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300/70">
              {card.label}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
              {card.value}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              {card.detail}
            </p>
          </article>
        ))}
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-4 rounded-3xl border border-r3mes-border bg-white/[0.03] p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                Basla
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">
                Knowledge-first calisma alani
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
                R3MES'te bilgi LoRA'ya gomulmez. Knowledge kaynaklari RAG
                hattina girer; LoRA ve skills yalniz davranis katmaninda kalir.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {quickActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="group rounded-2xl border border-white/10 bg-r3mes-bg/55 p-4 transition hover:border-cyan-400/35 hover:bg-cyan-400/[0.06]"
              >
                <h3 className="font-medium text-white group-hover:text-cyan-100">
                  {action.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                  {action.description}
                </p>
              </Link>
            ))}
          </div>
        </section>

        <aside className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
            Cüzdan
          </h2>
          <R3mesBalanceCard />
        </aside>
      </div>

      <section className="space-y-4 rounded-3xl border border-r3mes-border bg-r3mes-surface/25 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
              Skills
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              Behavior library
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
              Bu alan bilgi kaynagi degil; cevap tonu, rol ve agent davranisi
              icin opsiyonel skill katmanidir.
            </p>
          </div>
          <Link
            href="/studio"
            className="text-sm font-medium text-cyan-300 hover:text-cyan-200"
          >
            Studio'da yonet
          </Link>
        </div>
        <MarketplaceList />
      </section>
    </div>
  );
}
