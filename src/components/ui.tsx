"use client";

import clsx from "clsx";
import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { hueFor, initials } from "@/lib/format";

// ── Button ──────────────────────────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "quiet" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = "ghost",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "relative inline-flex items-center justify-center gap-2 rounded-[10px] font-medium",
        "transition-all duration-150 active:scale-[0.985] select-none",
        "disabled:pointer-events-none disabled:opacity-45",
        size === "sm" && "h-8 px-3 text-[12.5px]",
        size === "md" && "h-9.5 px-4 text-[13.5px]",
        size === "lg" && "h-11 px-5 text-[14.5px]",
        variant === "primary" &&
          "bg-signal text-ink-950 font-semibold shadow-[0_1px_0_rgba(255,255,255,.35)_inset,0_6px_20px_-8px_rgba(214,245,94,.65)] hover:bg-[#e2ff77]",
        variant === "ghost" &&
          "bg-white/[0.055] text-chalk border border-white/[0.09] hover:bg-white/[0.09] hover:border-white/15",
        variant === "outline" &&
          "border border-white/15 text-chalk-dim hover:text-chalk hover:border-white/25 hover:bg-white/[0.04]",
        variant === "quiet" &&
          "text-mute hover:text-chalk hover:bg-white/[0.055]",
        variant === "danger" &&
          "bg-danger/12 text-danger border border-danger/25 hover:bg-danger/20",
        className,
      )}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        "inline-block size-3.5 shrink-0 rounded-full border-[1.5px] border-current border-t-transparent animate-spin",
        className,
      )}
      aria-hidden
    />
  );
}

// ── Surfaces ────────────────────────────────────────────────────────────────

export function Panel({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={clsx("glass rounded-[16px]", className)}>
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  eyebrow,
  action,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex items-start justify-between gap-4 px-5 pt-4 pb-3.5",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="text-eyebrow mb-1.5">{eyebrow}</div> : null}
        <h2 className="text-[14px] font-semibold text-chalk truncate">{title}</h2>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ── Chips / badges ──────────────────────────────────────────────────────────

export function Chip({
  color,
  children,
  className,
  onClick,
  active,
  title,
}: {
  color?: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      title={title}
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] font-medium whitespace-nowrap",
        "border transition-colors",
        onClick && "cursor-pointer",
        className,
      )}
      style={
        color
          ? {
              color,
              background: active ? `${color}26` : `${color}16`,
              borderColor: active ? `${color}70` : `${color}33`,
            }
          : {
              color: "var(--color-chalk-dim)",
              background: active
                ? "rgba(255,255,255,.1)"
                : "rgba(255,255,255,.05)",
              borderColor: "var(--hairline)",
            }
      }
    >
      {children}
    </Tag>
  );
}

export function Dot({ color }: { color: string }) {
  return (
    <span
      className="size-[6px] rounded-full shrink-0"
      style={{ background: color, boxShadow: `0 0 8px ${color}88` }}
    />
  );
}

// ── Avatar ──────────────────────────────────────────────────────────────────

export function Avatar({
  name,
  seed,
  size = 28,
  className,
}: {
  name: string;
  seed?: string;
  size?: number;
  className?: string;
}) {
  const hue = hueFor(seed || name);
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center rounded-full font-semibold shrink-0 select-none",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: `linear-gradient(150deg, hsl(${hue} 62% 62% / .9), hsl(${(hue + 48) % 360} 58% 44% / .85))`,
        color: "#08090c",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.4)",
      }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

// ── Segmented control ───────────────────────────────────────────────────────

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "inline-flex items-center gap-0.5 rounded-[11px] p-0.5 glass-soft",
        "max-w-full overflow-x-auto no-scrollbar",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            "relative rounded-[9px] px-3 h-7.5 text-[12.5px] font-medium transition-all duration-150",
            "flex items-center gap-1.5 whitespace-nowrap shrink-0",
            value === option.value
              ? "bg-white/[0.1] text-chalk shadow-[inset_0_1px_0_rgba(255,255,255,.09)]"
              : "text-mute hover:text-chalk-dim",
          )}
        >
          {option.label}
          {option.count !== undefined && option.count > 0 ? (
            <span
              className={clsx(
                "tabular text-[10.5px] rounded-full px-1.5 py-px",
                value === option.value
                  ? "bg-signal/18 text-signal"
                  : "bg-white/[0.07] text-faint",
              )}
            >
              {option.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  width?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade">
      <div
        className="absolute inset-0 bg-ink-950/72 backdrop-blur-[3px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: "100%", maxWidth: width }}
        className="relative glass-deep rounded-[18px] animate-rise max-h-[88dvh] flex flex-col"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div>
            <h2 className="text-[17px] text-display text-chalk">{title}</h2>
            {description ? (
              <p className="text-[13px] text-mute mt-1 leading-relaxed max-w-[46ch]">
                {description}
              </p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 -mr-1.5 -mt-1 size-8 grid place-items-center rounded-lg text-faint hover:text-chalk hover:bg-white/[0.07] transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="rule-x mx-6" />
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ── Toasts ──────────────────────────────────────────────────────────────────

type Toast = { id: number; message: string; tone: "ok" | "error" | "info" };
const ToastCtx = createContext<(message: string, tone?: Toast["tone"]) => void>(
  () => {},
);

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(
      () => setToasts((current) => current.filter((t) => t.id !== id)),
      tone === "error" ? 6500 : 3800,
    );
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none w-[min(92vw,440px)]">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="glass-deep rounded-[12px] px-4 py-2.5 text-[13px] animate-rise pointer-events-auto flex items-center gap-2.5 w-full"
          >
            <Dot
              color={
                toast.tone === "error"
                  ? "#ff6b57"
                  : toast.tone === "ok"
                    ? "#5fd3b0"
                    : "#6bd5ff"
              }
            />
            <span className="text-chalk-dim leading-snug">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

export function Empty({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center text-center px-6 py-12",
        className,
      )}
    >
      {icon ? (
        <div className="mb-3.5 size-11 grid place-items-center rounded-[13px] glass-soft text-faint">
          {icon}
        </div>
      ) : null}
      <p className="text-[14px] text-chalk-dim font-medium">{title}</p>
      {hint ? (
        <p className="text-[12.5px] text-faint mt-1.5 max-w-[38ch] leading-relaxed">
          {hint}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

// ── Labelled field ──────────────────────────────────────────────────────────

export function Labeled({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-[12px] font-medium text-chalk-dim">{label}</span>
        {required ? (
          <span className="text-signal text-[13px] leading-none">·</span>
        ) : null}
      </span>
      {children}
      {hint ? (
        <span className="block text-[11.5px] text-faint mt-1.5 leading-relaxed">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

// ── Progress meter ──────────────────────────────────────────────────────────

export function Meter({
  value,
  color = "var(--color-signal)",
  className,
}: {
  value: number;
  color?: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "h-1 rounded-full bg-white/[0.07] overflow-hidden",
        className,
      )}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          background: color,
          boxShadow: `0 0 10px ${color}66`,
        }}
      />
    </div>
  );
}
