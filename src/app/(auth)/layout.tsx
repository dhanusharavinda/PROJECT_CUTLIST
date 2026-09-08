import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await currentUser()) redirect("/app");

  return (
    <div className="min-h-dvh grid lg:grid-cols-[1.05fr_1fr]">
      {/* Editorial side — carries the identity so the form can stay silent. */}
      <aside className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(46rem_34rem_at_18%_12%,rgba(214,245,94,.075),transparent_62%),radial-gradient(40rem_30rem_at_82%_88%,rgba(120,190,255,.08),transparent_60%)]" />

        <Link href="/" className="inline-flex items-center gap-2.5 w-fit">
          <span className="relative grid place-items-center size-7 rounded-[9px] bg-signal/12 border border-signal/25">
            <span className="absolute inset-x-[7px] top-[7px] h-px bg-signal/70" />
            <span className="absolute inset-x-[5px] bottom-[8px] h-px bg-signal/35" />
            <span className="absolute left-[9px] bottom-[6px] w-px h-2.5 bg-signal" />
          </span>
          <span className="text-display text-[17px]">Cutlist</span>
        </Link>

        <div className="max-w-[30ch]">
          <p className="text-display text-[clamp(2.2rem,3.4vw,3.1rem)] leading-[1.08]">
            The edit is already in your head.
            <span className="text-mute"> Say it once.</span>
          </p>
          <p className="text-[14px] text-mute mt-6 leading-relaxed max-w-[42ch]">
            Talk over your footage. Cutlist transcribes it, works out which
            instruction it was, and pins it to the frame — so the handoff is a
            cut list, not a wall of text.
          </p>
        </div>

        <div className="flex items-center gap-6 text-[11.5px] text-faint">
          <span>Self-hosted</span>
          <span className="size-1 rounded-full bg-faint/50" />
          <span>Your own AI keys</span>
          <span className="size-1 rounded-full bg-faint/50" />
          <span>Workspace isolation</span>
        </div>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
    </div>
  );
}
