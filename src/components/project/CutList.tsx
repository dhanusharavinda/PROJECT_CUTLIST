"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  Check,
  ChevronRight,
  CircleDashed,
  Loader,
  Plus,
  SkipForward,
  Sparkles,
  Trash2,
  MessageCircle,
  Pencil,
} from "lucide-react";
import { Button, Chip, Empty, Labeled, Modal, useToast } from "@/components/ui";
import { labelStyle } from "@/lib/labelStyle";
import { parseTimecode, relativeTime, timecode } from "@/lib/format";
import { LABEL_TYPES, type Label, type LabelType, type Video } from "@/lib/types";
import type { MessageWithAuthor } from "@/lib/queries";
import { api } from "./useProject";

type StatusFilter = "all" | "open" | "done";

const NEXT_STATUS: Record<Label["status"], Label["status"]> = {
  open: "doing",
  doing: "done",
  done: "open",
  skipped: "open",
};

export function CutList({
  projectId,
  labels,
  videos,
  canEdit,
  onChanged,
  onSeek,
  activeVideoId,
  compact,
  messages = [],
  meId,
  canChat = false,
}: {
  projectId: string;
  labels: Label[];
  videos: Video[];
  canEdit: boolean;
  onChanged: () => void;
  onSeek?: (videoId: string | null, ms: number) => void;
  /** When set, only this clip's instructions are shown. */
  activeVideoId?: string | null;
  compact?: boolean;
  /** Room messages — the ones pinned to an instruction surface on its row. */
  messages?: MessageWithAuthor[];
  meId?: string;
  canChat?: boolean;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [types, setTypes] = useState<Set<LabelType>>(new Set());
  const [editing, setEditing] = useState<Label | null>(null);
  const [creating, setCreating] = useState(false);

  /**
   * "How hard is the punch-in at 1:41?" belongs on the punch-in, not three
   * screens up in the room. Messages carrying a labelId are threaded here.
   */
  const threads = useMemo(() => {
    const byLabel = new Map<string, MessageWithAuthor[]>();
    for (const message of messages) {
      if (!message.meta) continue;
      let labelId: string | undefined;
      try {
        labelId = (JSON.parse(message.meta) as { labelId?: string }).labelId;
      } catch {
        continue;
      }
      if (!labelId) continue;
      byLabel.set(labelId, [...(byLabel.get(labelId) ?? []), message]);
    }
    return byLabel;
  }, [messages]);

  const scoped = useMemo(
    () =>
      activeVideoId === undefined
        ? labels
        : labels.filter((l) => l.video_id === activeVideoId || l.video_id === null),
    [labels, activeVideoId],
  );

  const visible = useMemo(
    () =>
      scoped.filter((label) => {
        if (status === "open" && !["open", "doing"].includes(label.status))
          return false;
        if (status === "done" && !["done", "skipped"].includes(label.status))
          return false;
        if (types.size && !types.has(label.type)) return false;
        return true;
      }),
    [scoped, status, types],
  );

  const presentTypes = useMemo(() => {
    const counts = new Map<LabelType, number>();
    for (const label of scoped)
      counts.set(label.type, (counts.get(label.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [scoped]);

  const openCount = scoped.filter((l) => ["open", "doing"].includes(l.status)).length;
  const doneCount = scoped.length - openCount;
  const titleById = new Map(videos.map((v) => [v.id, v.title]));

  async function patch(label: Label, changes: Record<string, unknown>) {
    try {
      await api(`/api/labels/${label.id}`, { method: "PATCH", json: changes });
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function remove(label: Label) {
    try {
      await api(`/api/labels/${label.id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div className="flex flex-col min-h-0">
      {/* Two rows rather than one wrapping row: the type filters can run to a
          dozen chips, and in the walkthrough's narrow side panel a single row
          collapses into an unreadable overflow. */}
      <div className={clsx("shrink-0 space-y-2", compact ? "px-3 py-3" : "mb-4")}>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-0.5 rounded-[10px] p-0.5 glass-soft">
            {(
              [
                ["open", "Open", openCount],
                ["done", "Done", doneCount],
                ["all", "All", scoped.length],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                onClick={() => setStatus(value)}
                className={clsx(
                  "rounded-[8px] px-2.5 h-7 text-[12px] font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap",
                  status === value
                    ? "bg-white/[0.1] text-chalk"
                    : "text-mute hover:text-chalk-dim",
                )}
              >
                {label}
                <span className="tabular text-[10px] text-faint">{count}</span>
              </button>
            ))}
          </div>

          <span className="flex-1" />

          {canEdit ? (
            <Button
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setCreating(true)}
            >
              Add
            </Button>
          ) : null}
        </div>

        {presentTypes.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1">
            {presentTypes.map(([type, count]) => {
              const style = labelStyle(type);
              const active = types.has(type);
              return (
                <Chip
                  key={type}
                  color={style.color}
                  active={active}
                  title={`${count} ${style.label.toLowerCase()}`}
                  onClick={() =>
                    setTypes((current) => {
                      const next = new Set(current);
                      if (next.has(type)) next.delete(type);
                      else next.add(type);
                      return next;
                    })
                  }
                >
                  {style.label}
                  <span className="tabular opacity-60">{count}</span>
                </Chip>
              );
            })}
          </div>
        ) : null}
      </div>

      {compact ? <div className="rule-x shrink-0" /> : null}

      <div className={clsx("min-h-0", compact && "flex-1 overflow-y-auto")}>
        {visible.length === 0 ? (
          <Empty
            icon={<Sparkles size={17} />}
            title={
              scoped.length === 0
                ? "No instructions yet"
                : "Nothing matches those filters"
            }
            hint={
              scoped.length === 0
                ? "Record a voice note over the footage. What you say becomes this list."
                : undefined
            }
          />
        ) : (
          <ul className={clsx(compact ? "px-2 py-2 space-y-1" : "space-y-1.5")}>
            {visible.map((label) => (
              <Row
                key={label.id}
                projectId={projectId}
                label={label}
                clip={label.video_id ? titleById.get(label.video_id) : null}
                showClip={activeVideoId === undefined && videos.length > 1}
                canEdit={canEdit}
                canChat={canChat}
                meId={meId}
                thread={threads.get(label.id) ?? []}
                onChanged={onChanged}
                onSeek={onSeek}
                onCycle={() => patch(label, { status: NEXT_STATUS[label.status] })}
                onSkip={() => patch(label, { status: "skipped" })}
                onEdit={() => setEditing(label)}
                onDelete={() => remove(label)}
              />
            ))}
          </ul>
        )}
      </div>

      <LabelModal
        projectId={projectId}
        videos={videos}
        label={editing}
        open={creating || Boolean(editing)}
        defaultVideoId={activeVideoId ?? null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={onChanged}
      />
    </div>
  );
}

function Row({
  projectId,
  label,
  clip,
  showClip,
  canEdit,
  canChat,
  meId,
  thread,
  onChanged,
  onSeek,
  onCycle,
  onSkip,
  onEdit,
  onDelete,
}: {
  projectId: string;
  label: Label;
  clip?: string | null;
  showClip: boolean;
  canEdit: boolean;
  canChat: boolean;
  meId?: string;
  thread: MessageWithAuthor[];
  onChanged: () => void;
  onSeek?: (videoId: string | null, ms: number) => void;
  onCycle: () => void;
  onSkip: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const style = labelStyle(label.type);
  const finished = label.status === "done" || label.status === "skipped";
  const hasDetail = Boolean(label.detail && label.detail !== label.title);

  // Someone asked and nobody else has replied since — that is what needs
  // the creator's attention, so it is what the row shouts about.
  const awaitingReply =
    thread.length > 0 &&
    thread[thread.length - 1].author_id !== meId &&
    !thread.some(
      (m, i) => i > 0 && m.author_id === meId && m.author_id !== thread[0].author_id,
    );

  async function ask() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api(`/api/projects/${projectId}/messages`, {
        method: "POST",
        json: {
          body: text,
          meta: {
            labelId: label.id,
            atMs: label.start_ms,
            videoId: label.video_id ?? undefined,
          },
        },
      });
      setDraft("");
      setAsking(false);
      setExpanded(true);
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <li
      className={clsx(
        "rounded-[11px] border transition-colors group",
        finished
          ? "border-white/[0.04] bg-white/[0.012]"
          : "border-white/[0.07] bg-white/[0.028] hover:bg-white/[0.05]",
      )}
      style={
        !finished && label.priority === "high"
          ? { boxShadow: `inset 2px 0 0 ${style.color}` }
          : undefined
      }
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <button
          onClick={canEdit ? onCycle : undefined}
          disabled={!canEdit}
          title={canEdit ? `Mark as ${NEXT_STATUS[label.status]}` : label.status}
          className={clsx(
            "mt-px size-[18px] shrink-0 grid place-items-center rounded-full border transition-colors",
            label.status === "done" && "bg-ok/20 border-ok/45 text-ok",
            label.status === "doing" && "border-mark-motion/50 text-mark-motion",
            label.status === "open" && "border-white/18 text-transparent hover:border-signal/60",
            label.status === "skipped" && "border-white/12 text-faint",
            canEdit ? "cursor-pointer" : "cursor-default",
          )}
        >
          {label.status === "done" ? (
            <Check size={11} strokeWidth={3} />
          ) : label.status === "doing" ? (
            <Loader size={11} />
          ) : label.status === "skipped" ? (
            <SkipForward size={10} />
          ) : (
            <CircleDashed size={11} />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onSeek?.(label.video_id, label.start_ms)}
              disabled={!onSeek}
              className="tabular text-[11px] text-mute hover:text-signal transition-colors disabled:pointer-events-none shrink-0"
            >
              {timecode(label.start_ms)}
              {label.end_ms ? `–${timecode(label.end_ms)}` : ""}
            </button>

            <span
              className="text-[10px] uppercase tracking-wider font-medium shrink-0"
              style={{ color: style.color }}
            >
              {style.label}
            </span>

            {label.priority === "high" && !finished ? (
              <span className="text-[10px] text-danger">high</span>
            ) : null}

            {label.origin === "heuristic" ? (
              <span
                className="text-[10px] text-faint"
                title="Extracted by keyword rules — no language model was connected"
              >
                rules
              </span>
            ) : null}

            {showClip && clip ? (
              <span className="text-[10px] text-faint truncate max-w-[14ch]">
                {clip}
              </span>
            ) : null}

            {thread.length > 0 ? (
              <button
                onClick={() => setExpanded(true)}
                className={clsx(
                  "inline-flex items-center gap-1 text-[10px] transition-colors",
                  awaitingReply
                    ? "text-warn"
                    : "text-faint hover:text-mute",
                )}
                title={
                  awaitingReply
                    ? "Waiting on an answer"
                    : `${thread.length} message${thread.length === 1 ? "" : "s"}`
                }
              >
                <MessageCircle size={10} />
                {thread.length}
                {awaitingReply ? " · needs an answer" : ""}
              </button>
            ) : null}
          </div>

          <button
            onClick={() =>
              (hasDetail || thread.length > 0) && setExpanded((v) => !v)
            }
            className={clsx(
              "block text-left w-full mt-1 text-[13px] leading-snug",
              finished ? "text-faint line-through" : "text-chalk-dim",
              (hasDetail || thread.length > 0) && "cursor-pointer",
            )}
          >
            {label.title}
            {hasDetail || thread.length > 0 ? (
              <ChevronRight
                size={12}
                className={clsx(
                  "inline-block ml-1 -mt-px text-faint transition-transform",
                  expanded && "rotate-90",
                )}
              />
            ) : null}
          </button>

          {expanded && hasDetail ? (
            <p className="mt-1.5 text-[12px] text-mute leading-relaxed border-l border-white/10 pl-2.5">
              {label.detail}
            </p>
          ) : null}

          {expanded && thread.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {thread.map((message) => (
                <li
                  key={message.id}
                  className="rounded-[8px] bg-white/[0.03] border border-white/[0.06] px-2.5 py-1.5"
                >
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={clsx(
                        "text-[10.5px] font-medium",
                        message.author_id === meId ? "text-signal" : "text-chalk",
                      )}
                    >
                      {message.author_id === meId
                        ? "You"
                        : (message.author_name ?? "Unknown")}
                    </span>
                    <span className="text-[9.5px] text-faint">
                      {relativeTime(message.created_at)}
                    </span>
                  </div>
                  <p className="text-[12px] text-mute leading-relaxed mt-0.5 whitespace-pre-wrap break-words">
                    {message.body}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}

          {asking ? (
            <div className="mt-2">
              <textarea
                autoFocus
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask();
                  }
                  if (e.key === "Escape") setAsking(false);
                }}
                placeholder={
                  thread.length ? "Reply…" : "What do you need to know about this?"
                }
                className="field resize-none text-[12px] leading-relaxed"
              />
              <div className="flex items-center justify-end gap-2 mt-1.5">
                <button
                  onClick={() => setAsking(false)}
                  className="text-[11px] text-faint hover:text-chalk"
                >
                  Cancel
                </button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={sending}
                  disabled={!draft.trim()}
                  onClick={ask}
                >
                  {thread.length ? "Reply" : "Ask"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {canEdit || canChat ? (
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {canChat ? (
              <button
                onClick={() => {
                  setAsking((v) => !v);
                  setExpanded(true);
                }}
                title={thread.length ? "Reply on this instruction" : "Ask about this instruction"}
                className="size-6 grid place-items-center rounded-md text-faint hover:text-chalk hover:bg-white/[0.07]"
              >
                <MessageCircle size={12} />
              </button>
            ) : null}
            {canEdit && !finished ? (
              <button
                onClick={onSkip}
                title="Skip"
                className="size-6 grid place-items-center rounded-md text-faint hover:text-mute hover:bg-white/[0.07]"
              >
                <SkipForward size={12} />
              </button>
            ) : null}
            {canEdit ? (
              <>
                <button
                  onClick={onEdit}
                  title="Edit"
                  className="size-6 grid place-items-center rounded-md text-faint hover:text-chalk hover:bg-white/[0.07]"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={onDelete}
                  title="Delete"
                  className="size-6 grid place-items-center rounded-md text-faint hover:text-danger hover:bg-danger/10"
                >
                  <Trash2 size={12} />
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function LabelModal({
  projectId,
  videos,
  label,
  open,
  defaultVideoId,
  onClose,
  onSaved,
}: {
  projectId: string;
  videos: Video[];
  label: Label | null;
  open: boolean;
  defaultVideoId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    type: "cut" as LabelType,
    title: "",
    detail: "",
    at: "0:00",
    priority: "normal" as Label["priority"],
    videoId: defaultVideoId ?? "",
  });
  const [seeded, setSeeded] = useState<string | null>(null);

  // Re-seed whenever a different label is opened for editing.
  const key = label?.id ?? (open ? "new" : null);
  if (key && key !== seeded) {
    setSeeded(key);
    setForm({
      type: label?.type ?? "cut",
      title: label?.title ?? "",
      detail: label?.detail ?? "",
      at: timecode(label?.start_ms ?? 0),
      priority: label?.priority ?? "normal",
      videoId: label?.video_id ?? defaultVideoId ?? "",
    });
  }
  if (!open && seeded) setSeeded(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const startMs = parseTimecode(form.at);
    if (startMs === null) return toast("That timecode doesn't parse. Try 1:23.", "error");

    setBusy(true);
    try {
      if (label) {
        await api(`/api/labels/${label.id}`, {
          method: "PATCH",
          json: {
            type: form.type,
            title: form.title,
            detail: form.detail,
            startMs,
            priority: form.priority,
          },
        });
      } else {
        await api(`/api/projects/${projectId}/labels`, {
          method: "POST",
          json: {
            type: form.type,
            title: form.title,
            detail: form.detail,
            startMs,
            priority: form.priority,
            videoId: form.videoId || null,
          },
        });
      }
      onClose();
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={label ? "Edit instruction" : "Add an instruction"}
      width={470}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Labeled label="Type">
            <select
              className="field cursor-pointer"
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as LabelType })
              }
            >
              {LABEL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {labelStyle(type).label}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="At" hint="mm:ss or h:mm:ss">
            <input
              className="field tabular"
              value={form.at}
              onChange={(e) => setForm({ ...form, at: e.target.value })}
              placeholder="1:23"
            />
          </Labeled>
        </div>

        <Labeled label="Instruction" required>
          <input
            autoFocus
            required
            className="field"
            placeholder="Cut the pause before the demo"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Labeled>

        <Labeled label="Detail">
          <textarea
            rows={3}
            className="field resize-y leading-relaxed"
            placeholder="Anything the editor needs beyond the one-liner."
            value={form.detail}
            onChange={(e) => setForm({ ...form, detail: e.target.value })}
          />
        </Labeled>

        <div className="grid grid-cols-2 gap-4">
          <Labeled label="Priority">
            <select
              className="field cursor-pointer"
              value={form.priority}
              onChange={(e) =>
                setForm({ ...form, priority: e.target.value as Label["priority"] })
              }
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </Labeled>

          {!label ? (
            <Labeled label="Clip">
              <select
                className="field cursor-pointer"
                value={form.videoId}
                onChange={(e) => setForm({ ...form, videoId: e.target.value })}
              >
                <option value="">Whole project</option>
                {videos.map((video) => (
                  <option key={video.id} value={video.id}>
                    {video.title}
                  </option>
                ))}
              </select>
            </Labeled>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {label ? "Save changes" : "Add instruction"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
