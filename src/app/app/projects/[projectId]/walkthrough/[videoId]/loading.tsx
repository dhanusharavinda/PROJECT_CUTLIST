export default function Loading() {
  return (
    <div className="lg:h-dvh flex flex-col" aria-busy="true">
      <span className="sr-only">Loading walkthrough…</span>

      <div className="shrink-0 h-14 flex items-center gap-3 px-4 border-b border-white/[0.06]">
        <div className="h-3 w-32 rounded skeleton" />
        <div className="h-3 w-40 rounded skeleton" />
      </div>

      <div className="flex-1 min-h-0 grid lg:grid-cols-[176px_minmax(0,1fr)_348px]">
        <div className="hidden lg:block border-r border-white/[0.06] p-3 space-y-2">
          <div className="h-2.5 w-12 rounded skeleton mb-3" />
          {[0, 1].map((i) => (
            <div key={i} className="h-11 rounded-[10px] skeleton" />
          ))}
        </div>

        <div className="p-4 space-y-3">
          <div className="aspect-video rounded-[13px] skeleton max-h-[calc(100dvh-330px)]" />
          <div className="h-14 rounded-[13px] skeleton" />
          <div className="h-[68px] rounded-[11px] skeleton" />
          <div className="h-[76px] rounded-[14px] skeleton" />
        </div>

        <div className="hidden lg:block border-l border-white/[0.06] p-3 space-y-2.5">
          <div className="h-8 rounded-[11px] skeleton" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-[12px] skeleton" />
          ))}
        </div>
      </div>
    </div>
  );
}
