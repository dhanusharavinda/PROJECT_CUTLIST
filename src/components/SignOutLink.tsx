"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/ui";

/** Sign-out as a plain action, for dead-end screens outside the app shell. */
export function SignOutLink() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/");
        router.refresh();
      }}
      disabled={busy}
      className="h-10 px-4 inline-flex items-center gap-2 rounded-[10px] border border-white/15 text-[13.5px] text-chalk-dim hover:text-chalk hover:border-white/25 hover:bg-white/[0.04] transition-colors disabled:opacity-50"
    >
      {busy ? <Spinner /> : null}
      Sign out
    </button>
  );
}
