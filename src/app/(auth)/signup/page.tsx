"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, Labeled } from "@/components/ui";

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const inviteToken = params.get("invite") ?? undefined;

  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          // The server ignores this when an invite decides the workspace.
          workspaceName: inviteToken ? name || "Workspace" : workspaceName,
          inviteToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create the account.");
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

      <h1 className="text-display text-[30px]">
        {inviteToken ? "Join the workspace" : "Create your workspace"}
      </h1>
      <p className="text-[13.5px] text-mute mt-2">
        {inviteToken
          ? "You were invited. Set up your account to get in."
          : "One workspace per client keeps footage, notes and keys apart."}
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <Labeled label="Your name">
          <input
            required
            autoFocus
            autoComplete="name"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ada Okafor"
          />
        </Labeled>

        <Labeled label="Email">
          <input
            type="email"
            required
            autoComplete="email"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@studio.com"
          />
        </Labeled>

        <Labeled label="Password" hint="At least 8 characters.">
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Labeled>

        {!inviteToken ? (
          <Labeled
            label="Workspace name"
            hint="Your channel, your studio, or the client this is for."
          >
            <input
              required
              className="field"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="Ada's channel"
            />
          </Labeled>
        ) : null}

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
          {inviteToken ? "Join workspace" : "Create workspace"}
          {!busy && <ArrowRight size={16} />}
        </Button>
      </form>

      <p className="text-[13px] text-mute mt-7">
        Already set up?{" "}
        <Link href="/login" className="text-signal hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-[14px] skeleton" />}>
      <SignupForm />
    </Suspense>
  );
}
