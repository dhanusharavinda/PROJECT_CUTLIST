/** Shaped like the template library so nothing jumps when it arrives. */
export default function Loading() {
  return (
    <div className="px-5 sm:px-8 py-7 max-w-[1180px]" aria-busy="true">
      <span className="sr-only">Loading templates…</span>

      <div className="h-3 w-20 rounded skeleton" />
      <div className="h-9 w-48 rounded-lg skeleton mt-3" />
      <div className="h-3 w-[60%] max-w-[420px] rounded skeleton mt-4" />

      <div className="mt-8 grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="glass rounded-[14px] p-4">
            <div className="h-4 w-2/3 rounded skeleton" />
            <div className="h-2.5 w-1/2 rounded skeleton mt-2.5" />
            <div className="h-5 w-20 rounded-full skeleton mt-4" />
            <div className="space-y-2 mt-4">
              <div className="h-2.5 w-full rounded skeleton" />
              <div className="h-2.5 w-5/6 rounded skeleton" />
              <div className="h-2.5 w-2/3 rounded skeleton" />
            </div>
            <div className="h-8 w-28 rounded-[10px] skeleton mt-5" />
          </div>
        ))}
      </div>
    </div>
  );
}
