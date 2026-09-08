/**
 * Shown while a workspace screen resolves. Deliberately shaped like the real
 * dashboard so nothing jumps when the content arrives.
 */
export default function Loading() {
  return (
    <div className="px-5 sm:px-8 py-8 max-w-[1400px]" aria-busy="true">
      <span className="sr-only">Loading your workspace…</span>

      <div className="h-3 w-24 rounded skeleton" />
      <div className="h-9 w-64 rounded-lg skeleton mt-4" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-8">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass rounded-[14px] px-4 py-3.5">
            <div className="h-2.5 w-20 rounded skeleton" />
            <div className="h-7 w-14 rounded skeleton mt-3.5" />
            <div className="h-2 w-24 rounded skeleton mt-3" />
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_310px] gap-6 mt-9 items-start">
        <div>
          <div className="h-4 w-20 rounded skeleton mb-4" />
          <div className="grid sm:grid-cols-2 gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="glass rounded-[15px] p-4">
                <div className="h-4 w-3/4 rounded skeleton" />
                <div className="h-2.5 w-full rounded skeleton mt-3" />
                <div className="h-2.5 w-2/3 rounded skeleton mt-2" />
                <div className="h-1 w-full rounded-full skeleton mt-5" />
                <div className="h-2.5 w-1/2 rounded skeleton mt-4" />
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-[16px] p-5 space-y-4">
          <div className="h-2.5 w-16 rounded skeleton" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i}>
              <div className="h-2.5 w-full rounded skeleton" />
              <div className="h-2 w-1/3 rounded skeleton mt-2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
