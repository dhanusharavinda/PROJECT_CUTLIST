export default function Loading() {
  return (
    <div className="lg:h-dvh flex flex-col" aria-busy="true">
      <span className="sr-only">Loading the reel…</span>

      <div className="shrink-0 h-14 flex items-center gap-3 px-4 border-b border-white/[0.06]">
        <div className="h-3 w-24 rounded skeleton" />
        <div className="h-3 w-36 rounded skeleton" />
      </div>

      <div className="flex-1 min-h-0 p-4 space-y-3">
        {/* The stage keeps a portrait shape, which is what the footage is. */}
        <div className="mx-auto w-full max-w-[380px] aspect-[9/16] max-h-[52vh] rounded-[13px] skeleton" />
        <div className="h-[26px] rounded-[8px] skeleton" />
        <div className="h-9 w-64 rounded-[11px] skeleton" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-[12px] skeleton" />
        ))}
      </div>
    </div>
  );
}
