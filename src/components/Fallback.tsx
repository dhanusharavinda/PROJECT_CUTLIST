import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The shared shape for every dead-end the app can reach: 404, a thrown error,
 * a signed-out session, a workspace you were removed from.
 *
 * Every one of them names what happened in plain language and offers at least
 * one way out. No raw stack traces, no bare status codes.
 */
export function FullPageState({
  eyebrow,
  title,
  body,
  actions,
  detail,
}: {
  eyebrow: string;
  title: string;
  body: ReactNode;
  actions?: ReactNode;
  /** Technical detail, folded away — useful when reporting a bug. */
  detail?: string;
}) {
  return (
    <div className="min-h-dvh grid place-items-center px-6 py-16">
      <div className="w-full max-w-[460px] animate-rise">
        <Mark />
        <span className="text-eyebrow block mt-7">{eyebrow}</span>
        <h1 className="text-display text-[clamp(1.7rem,4vw,2.2rem)] mt-3 leading-[1.12]">
          {title}
        </h1>
        <div className="text-[13.5px] text-mute mt-4 leading-[1.65]">{body}</div>

        {actions ? (
          <div className="mt-7 flex flex-wrap items-center gap-2.5">{actions}</div>
        ) : null}

        {detail ? (
          <details className="mt-8 group">
            <summary className="text-[11.5px] text-faint cursor-pointer hover:text-mute list-none select-none">
              Technical detail
            </summary>
            <pre className="mt-2 text-[11px] text-faint/90 leading-relaxed whitespace-pre-wrap break-words glass-soft rounded-[10px] p-3 max-h-[9rem] overflow-auto">
              {detail}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

/** The wordmark glyph, enlarged — a quiet anchor rather than a sad-face icon. */
function Mark() {
  return (
    <span
      aria-hidden
      className="relative grid place-items-center size-11 rounded-[13px] bg-signal/10 border border-signal/20"
    >
      <span className="absolute inset-x-[11px] top-[11px] h-px bg-signal/60" />
      <span className="absolute inset-x-[8px] bottom-[13px] h-px bg-signal/30" />
      <span className="absolute left-[14px] bottom-[10px] w-px h-4 bg-signal" />
    </span>
  );
}

export function FallbackLink({
  href,
  children,
  primary,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "h-10 px-4 inline-flex items-center rounded-[10px] bg-signal text-ink-950 text-[13.5px] font-semibold hover:bg-[#e2ff77] transition-colors"
          : "h-10 px-4 inline-flex items-center rounded-[10px] border border-white/15 text-[13.5px] text-chalk-dim hover:text-chalk hover:border-white/25 hover:bg-white/[0.04] transition-colors"
      }
    >
      {children}
    </Link>
  );
}
