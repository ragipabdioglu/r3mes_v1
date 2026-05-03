/**
 * Yerel/QA test adaptörü — gerçek behavior library onayı veya benchmark ile karıştırılmaz.
 */
export function DevTestPill() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-200/90 ring-1 ring-amber-500/35"
      title="Benchmark veya behavior library onayı yok; yerel test içindir."
    >
      dev test
    </span>
  );
}
