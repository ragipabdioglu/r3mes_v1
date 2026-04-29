import { fetchActiveAdaptersSorted } from "@/lib/api/adapters";
import { DevTestPill } from "@/components/dev-test-pill";
import type { AdapterListItem } from "@/lib/types/adapter";
import { isDevTestAdapter } from "@/lib/types/adapter-dev-test";
import { userFacingFetchFailure } from "@/lib/ui/http-messages";
import { backendUrlHint, marketplace } from "@/lib/ui/product-copy";
import Link from "next/link";

function MarketplaceCard({ a }: { a: AdapterListItem }) {
  const dev = isDevTestAdapter(a);
  const score =
    dev || a.benchmarkScore == null
      ? "—"
      : a.benchmarkScore.toFixed(1);
  const chatHref = `/chat?adapter=${encodeURIComponent(a.id)}`;

  return (
    <Link
      href={chatHref}
      className="group block rounded-xl border border-r3mes-border bg-r3mes-surface/50 p-4 transition hover:border-violet-500/40 hover:bg-r3mes-surface"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-white group-hover:text-violet-200">
              {a.name}
            </h3>
            {dev ? <DevTestPill /> : null}
          </div>
          {a.ipfsCid ? (
            <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">
              {a.ipfsCid}
            </p>
          ) : null}
        </div>
        <span
          className={
            dev
              ? "shrink-0 rounded-lg bg-zinc-800/80 px-2 py-1 text-xs font-medium text-zinc-400"
              : "shrink-0 rounded-lg bg-violet-500/15 px-2 py-1 text-xs font-medium text-violet-200"
          }
        >
          Stil skoru {score}
        </span>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-zinc-500">
        Bilgi için knowledge kaynakları kullanılır; bu kayıt yalnız davranış, ton ve persona katmanıdır.
      </p>
    </Link>
  );
}

export async function MarketplaceList() {
  let items: AdapterListItem[] = [];
  let loadFailed = false;
  try {
    items = await fetchActiveAdaptersSorted();
  } catch {
    loadFailed = true;
  }

  if (loadFailed) {
    return (
      <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 p-4 text-sm text-amber-100/90">
        <p className="font-medium">{userFacingFetchFailure("marketplace")}</p>
        <p className="mt-2 text-xs text-zinc-500">{backendUrlHint}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-zinc-500">
        {marketplace.emptyLine}{" "}
        <Link
          href="/studio"
          className="font-medium text-violet-400 underline-offset-2 hover:text-violet-300 hover:underline"
        >
          {marketplace.studioLinkLabel}
        </Link>
      </p>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((a) => (
        <li key={a.id}>
          <MarketplaceCard a={a} />
        </li>
      ))}
    </ul>
  );
}
