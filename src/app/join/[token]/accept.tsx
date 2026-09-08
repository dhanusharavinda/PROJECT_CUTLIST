"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui";

export function AcceptInvite({
  token,
  workspace,
}: {
  token: string;
  workspace: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not join.");
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        loading={busy}
        onClick={accept}
      >
        Join {workspace}
        {!busy && <ArrowRight size={16} />}
      </Button>
      {error ? (
        <p className="text-[12.5px] text-danger bg-danger/8 border border-danger/20 rounded-[9px] px-3 py-2">
          {error}
        </p>
      ) : null}
    </div>
  );
}
