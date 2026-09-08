"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Send, Sparkles } from "lucide-react";
import { Avatar, Empty, Spinner, useToast } from "@/components/ui";
import { relativeTime, timecode } from "@/lib/format";
import type { MessageWithAuthor } from "@/lib/queries";
import { api, type Connection, type Presence } from "./useProject";

export function Room({
  projectId,
  messages,
  presence,
  connection,
  canChat,
  meId,
  atMs,
  videoId,
  onSeek,
  labelTitles,
  className,
}: {
  projectId: string;
  messages: MessageWithAuthor[];
  presence: Presence[];
  connection: Connection;
  canChat: boolean;
  meId: string;
  /** Current playhead, when the room is open beside a player. */
  atMs?: number;
  videoId?: string | null;
  onSeek?: (ms: number) => void;
  /** Instruction id → title, so a pinned message can name what it is about. */
  labelTitles?: Map<string, string>;
  className?: string;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pin, setPin] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Only auto-scroll when the reader is already at the bottom — otherwise
  // a new message yanks them away from what they were reading.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send() {
    const bodyText = draft.trim();
    if (!bodyText || sending) return;
    setSending(true);
    try {
      await api(`/api/projects/${projectId}/messages`, {
        method: "POST",
        json: {
          body: bodyText,
          meta:
            pin && atMs !== undefined
              ? { atMs: Math.round(atMs), videoId: videoId ?? undefined }
              : undefined,
        },
      });
      setDraft("");
      stickToBottom.current = true;
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={clsx("flex flex-col min-h-0", className)}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-eyebrow">Room</span>
          {/* Silence is ambiguous when a connection drops, so say it outright
              rather than dimming a dot nobody was watching. */}
          {connection === "live" ? (
            <span
              className="size-1.5 rounded-full bg-ok shadow-[0_0_7px_var(--color-ok)]"
              role="status"
              aria-label="Live"
            />
          ) : connection === "down" ? (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 rounded-full border border-warn/25 bg-warn/[0.08] px-2 py-[1px] text-[10px] text-warn"
            >
              <span className="size-1 rounded-full bg-warn [animation:pulse-rec_1.4s_ease-in-out_infinite]" />
              Reconnecting
            </span>
          ) : (
            <span
              className="size-1.5 rounded-full bg-faint/50"
              role="status"
              aria-label="Connecting"
            />
          )}
        </div>
        {presence.length > 0 ? (
          <div className="flex -space-x-1.5">
            {presence.slice(0, 5).map((person) => (
              <Avatar
                key={person.id}
                name={person.name}
                seed={person.id}
                size={20}
                className="ring-2 ring-ink-950"
              />
            ))}
            {presence.length > 5 ? (
              <span className="size-5 rounded-full grid place-items-center bg-white/10 text-[9px] text-mute ring-2 ring-ink-950">
                +{presence.length - 5}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rule-x shrink-0" />

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3"
      >
        {messages.length === 0 ? (
          <Empty
            title="Nothing said yet"
            hint="Questions about a specific moment land here, next to the footage they're about."
          />
        ) : (
          messages.map((message, index) => {
            const previous = messages[index - 1];
            const grouped =
              previous &&
              previous.author_id === message.author_id &&
              previous.kind === message.kind &&
              message.created_at - previous.created_at < 4 * 60 * 1000;

            return (
              <MessageRow
                key={message.id}
                message={message}
                grouped={Boolean(grouped)}
                mine={message.author_id === meId}
                onSeek={onSeek}
                labelTitles={labelTitles}
              />
            );
          })
        )}
      </div>

      {canChat ? (
        <div className="shrink-0 border-t border-white/[0.06] p-3">
          {atMs !== undefined ? (
            <button
              onClick={() => setPin((v) => !v)}
              className={clsx(
                "mb-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] border transition-colors",
                pin
                  ? "text-signal bg-signal/12 border-signal/35"
                  : "text-faint border-white/10 hover:text-mute",
              )}
            >
              <span className="tabular">{timecode(atMs)}</span>
              {pin ? "attached" : "attach timestamp"}
            </button>
          ) : null}

          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about a moment…"
              className="field resize-none leading-relaxed max-h-[132px]"
            />
            <button
              onClick={send}
              disabled={!draft.trim() || sending}
              className="size-9 shrink-0 grid place-items-center rounded-[10px] bg-signal text-ink-950 disabled:opacity-35 disabled:pointer-events-none hover:bg-[#e2ff77] transition-colors"
              aria-label="Send"
            >
              {sending ? <Spinner /> : <Send size={15} />}
            </button>
          </div>
        </div>
      ) : (
        <p className="shrink-0 border-t border-white/[0.06] px-4 py-3 text-[12px] text-faint">
          You have view-only access to this workspace.
        </p>
      )}
    </div>
  );
}

function MessageRow({
  message,
  grouped,
  mine,
  onSeek,
  labelTitles,
}: {
  message: MessageWithAuthor;
  grouped: boolean;
  mine: boolean;
  onSeek?: (ms: number) => void;
  labelTitles?: Map<string, string>;
}) {
  let meta: {
    atMs?: number;
    videoId?: string;
    labelId?: string;
    items?: number;
    model?: string;
  } = {};
  try {
    meta = message.meta ? JSON.parse(message.meta) : {};
  } catch {
    meta = {};
  }
  const labelTitle = meta.labelId ? labelTitles?.get(meta.labelId) : undefined;

  if (message.kind === "ai") {
    return (
      <div className="rounded-[11px] border border-signal/22 bg-signal/[0.06] px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Sparkles size={11} className="text-signal" />
          <span className="text-[10.5px] text-signal font-medium">
            Review pass
          </span>
          {meta.model ? (
            <span className="text-[10px] text-faint truncate">{meta.model}</span>
          ) : null}
        </div>
        <p className="text-[12.5px] text-chalk-dim leading-relaxed">
          {message.body}
        </p>
        {meta.items ? (
          <p className="text-[11px] text-faint mt-1.5">
            {meta.items} suggestion{meta.items === 1 ? "" : "s"} in the Review tab
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={clsx("flex gap-2.5", grouped && "mt-1")}>
      <div className="w-6 shrink-0 pt-0.5">
        {!grouped ? (
          <Avatar
            name={message.author_name ?? "Unknown"}
            seed={message.author_id ?? "x"}
            size={24}
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped ? (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span
              className={clsx(
                "text-[12px] font-medium",
                mine ? "text-signal" : "text-chalk",
              )}
            >
              {mine ? "You" : (message.author_name ?? "Unknown")}
            </span>
            <span className="text-[10px] text-faint">
              {relativeTime(message.created_at)}
            </span>
          </div>
        ) : null}

        <p className="text-[12.5px] text-chalk-dim leading-relaxed whitespace-pre-wrap break-words">
          {message.body}
        </p>

        {meta.atMs !== undefined ? (
          <button
            onClick={() => onSeek?.(meta.atMs!)}
            disabled={!onSeek}
            className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-white/12 px-2 py-0.5 text-[10.5px] text-mute hover:text-signal hover:border-signal/35 transition-colors disabled:pointer-events-none"
          >
            <span className="tabular">{timecode(meta.atMs)}</span>
            {/* Named so a reply in the room still says which instruction it is
                about, even though the thread also lives on the row. */}
            {labelTitle ? (
              <span className="truncate max-w-[22ch] opacity-80">
                on “{labelTitle}”
              </span>
            ) : null}
          </button>
        ) : null}
      </div>
    </div>
  );
}
