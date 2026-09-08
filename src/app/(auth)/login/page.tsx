"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, Labeled } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not sign you in.");
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="animate-rise">
      <Link
        href="/"
        className="lg:hidden inline-flex items-center gap-2.5 mb-8 text-display text-[17px]"
      >
        <span className="relative grid place-items-center size-7 rounded-[9px] bg-signal/12 border border-signal/25">
          <span className="absolute inset-x-[7px] top-[7px] h-px bg-signal/70" />
          <span className="absolute left-[9px] bottom-[6px] w-px h-2.5 bg-signal" />
        </span>
        Cutlist
      </Link>

      <h1 className="text-display text-[30px]">Welcome back</h1>
      <p className="text-[13.5px] text-mute mt-2">
        Sign in to your workspace.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <Labeled label="Email">
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@studio.com"
          />
        </Labeled>

        <Labeled label="Password">
          <input
            type="password"
            required
            autoComplete="current-password"
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Labeled>

        {error ? (
          <p className="text-[12.5px] text-danger bg-danger/8 border border-danger/20 rounded-[9px] px-3 py-2">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={busy}
          className="w-full"
        >
          Sign in
          {!busy && <ArrowRight size={16} />}
        </Button>
      </form>

      <p className="text-[13px] text-mute mt-7">
        No workspace yet?{" "}
        <Link href="/signup" className="text-signal hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
