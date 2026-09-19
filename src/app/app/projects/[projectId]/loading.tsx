export default function Loading() {
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_326px] lg:h-[calc(100dvh-3rem)]" aria-busy="true">
      <span className="sr-only">Loading project…</span>

      <div className="min-w-0 px-5 sm:px-8 pt-7">
        <div className="h-5 w-20 rounded-full skeleton" />
        <div className="h-9 w-2/3 max-w-[28rem] rounded-lg skeleton mt-4" />
        <div className="h-3 w-1/2 max-w-[34rem] rounded skeleton mt-3" />

        <div className="flex items-center gap-6 mt-7">
          <div className="h-2 w-44 rounded-full skeleton" />
          <div className="h-2 w-16 rounded skeleton" />
          <div className="h-2 w-16 rounded skeleton" />
        </div>

        <div className="h-9 w-80 max-w-full rounded-[11px] skeleton mt-6" />

        <div className="mt-6 space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-[11px] skeleton" />
          ))}
        </div>
      </div>

      <div className="hidden lg:block border-l border-white/[0.06] p-4 space-y-4">
        <div className="h-2.5 w-14 rounded skeleton" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-2.5">
            <div className="size-6 rounded-full skeleton shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 w-24 rounded skeleton" />
              <div className="h-2.5 w-full rounded skeleton" />
              <div className="h-2.5 w-4/5 rounded skeleton" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
