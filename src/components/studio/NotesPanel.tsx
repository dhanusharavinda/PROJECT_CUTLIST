"use client";

import { useState } from "react";
import clsx from "clsx";
import {
  AlertCircle,
  Check,
  Mic,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { Avatar, Empty, Spinner, useToast } from "@/components/ui";
import { relativeTime, timecode } from "@/lib/format";
import { labelStyle } from "@/lib/labelStyle";
import type { NoteWithTranscript } from "@/lib/queries";
import type { Label } from "@/lib/types";
import { api } from "@/components/project/useProject";

export function NotesPanel({
  notes,
  labels,
  meId,
  canEdit,
  onSeek,
  onChanged,
}: {
  notes: NoteWithTranscript[];
  labels: Label[];
  meId: string;
  canEdit: boolean;
  onSeek: (ms: number) => void;
  onChanged: () => void;
}) {
  if (notes.length === 0) {
    return (
      <Empty
        icon={<Mic size={17} />}
        title="No notes on this clip"
        hint="Park the playhead where you want to talk about, hit record, and say it the way you'd say it out loud."
      />
    );
  }

  return (
    <ul className="px-3 py-3 space-y-2.5">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          labels={labels.filter((l) => l.note_id === note.id)}
          meId={meId}
          canEdit={canEdit}
          onSeek={onSeek}
          onChanged={onChanged}
        />
      ))}
    </ul>
  );
}

function NoteCard({
  note,
  labels,
  meId,
  canEdit,
  onSeek,
  onChanged,
}: {
  note: NoteWithTranscript;
  labels: Label[];
  meId: string;
  canEdit: boolean;
  onSeek: (ms: number) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);

  const mine = note.author_id === meId;
  const failed = note.transcribe_status === "failed";
  const pending =
    note.transcribe_status === "queued" || note.transcribe_status === "running";

  async function saveText() {
    setBusy(true);
    try {
      await api(`/api/notes/${note.id}`, {
        method: "PATCH",
        json: { text: draft },
      });
      // Re-label from the corrected text, without re-hitting the STT provider.
      await api(`/api/notes/${note.id}/process?transcribe=0`, { method: "POST" });
      setEditing(false);
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    try {
      await api(`/api/notes/${note.id}/process`, { method: "POST" });
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this note and the instructions it produced?")) return;
    try {
      await api(`/api/notes/${note.id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  function playAudio() {
    const audio = new Audio(`/api/notes/${note.id}/audio`);
    setPlaying(true);
    audio.onended = () => setPlaying(false);
    audio.onerror = () => {
      setPlaying(false);
      toast("Could not play that recording.", "error");
    };
    void audio.play().catch(() => setPlaying(false));
  }

  return (
    <li className="rounded-[12px] border border-white/[0.07] bg-white/[0.025] overflow-hidden">
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <Avatar name={note.author_name ?? "?"} seed={note.author_id} size={20} />
        <span className="text-[11.5px] text-chalk-dim truncate">
          {mine ? "You" : (note.author_name ?? "Unknown")}
        </span>
        <button
          onClick={() => onSeek(note.anchor_ms)}
          className="tabular text-[10.5px] text-mute hover:text-signal transition-colors"
        >
          {timecode(note.anchor_ms)}
        </button>
        <span className="text-[10px] text-faint">
          {relativeTime(note.created_at)}
        </span>

        <span className="ml-auto flex items-center gap-1 shrink-0">
          {note.kind === "voice" ? (
            <button
              onClick={playAudio}
              title="Play the original recording"
              className="size-6 grid place-items-center rounded-md text-faint hover:text-chalk hover:bg-white/[0.07]"
            >
              {playing ? <Spinner /> : <Play size={11} fill="currentColor" />}
            </button>
          ) : (
            <Type size={11} className="text-faint" />
          )}
          {canEdit && (mine || note.kind === "text") ? (
            <button
              onClick={() => {
                setDraft(note.text);
                setEditing((v) => !v);
              }}
              title="Correct the transcript"
              className="size-6 grid place-items-center rounded-md text-faint hover:text-chalk hover:bg-white/[0.07]"
            >
              <Pencil size={11} />
            </button>
          ) : null}
          {canEdit && mine ? (
            <button
              onClick={remove}
              title="Delete note"
              className="size-6 grid place-items-center rounded-md text-faint hover:text-danger hover:bg-danger/10"
            >
              <Trash2 size={11} />
            </button>
          ) : null}
        </span>
      </div>

      <div className="px-3 pb-3">
        {editing ? (
          <div>
            <textarea
              autoFocus
              rows={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="field resize-y leading-relaxed text-[12.5px]"
            />
            <div className="flex items-center justify-end gap-1.5 mt-2">
              <button
                onClick={() => setEditing(false)}
                className="size-7 grid place-items-center rounded-lg text-faint hover:text-chalk hover:bg-white/[0.07]"
              >
                <X size={13} />
              </button>
              <button
                onClick={saveText}
                disabled={busy}
                title="Save and re-label"
                className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-lg bg-signal text-ink-950 text-[11.5px] font-medium disabled:opacity-50"
              >
                {busy ? <Spinner /> : <Check size={12} />}
                Save &amp; re-label
              </button>
            </div>
          </div>
        ) : pending ? (
          <p className="text-[12px] text-mute flex items-center gap-2">
            <Spinner /> Transcribing…
          </p>
        ) : failed ? (
          <div className="rounded-[9px] border border-danger/22 bg-danger/[0.07] px-2.5 py-2">
            <p className="text-[11.5px] text-danger flex items-start gap-1.5 leading-relaxed">
              <AlertCircle size={12} className="shrink-0 mt-px" />
              {note.transcribe_error ?? "Transcription failed."}
            </p>
            {canEdit ? (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={retry}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-[11px] text-chalk-dim hover:text-chalk"
                >
                  {busy ? <Spinner /> : <RefreshCw size={11} />} Retry
                </button>
                <button
                  onClick={() => {
                    setDraft(note.text);
                    setEditing(true);
                  }}
                  className="text-[11px] text-chalk-dim hover:text-chalk"
                >
                  Type it instead
                </button>
              </div>
            ) : null}
          </div>
        ) : note.text ? (
          <p className="text-[12.5px] text-chalk-dim leading-[1.6] whitespace-pre-wrap">
            {note.text}
          </p>
        ) : (
          <p className="text-[12px] text-faint italic">Empty note.</p>
        )}

        {note.segments.length > 1 && !editing ? (
          <details className="mt-2 group">
            <summary className="text-[10.5px] text-faint cursor-pointer hover:text-mute list-none">
              {note.segments.length} timed segments
            </summary>
            <ul className="mt-1.5 space-y-1 border-l border-white/[0.08] pl-2.5">
              {note.segments.map((segment) => (
                <li key={segment.id} className="text-[11.5px] text-mute leading-snug">
                  <span className="tabular text-faint mr-1.5">
                    {timecode(segment.start_ms)}
                  </span>
                  {segment.text}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {labels.length > 0 ? (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {labels.map((label) => {
              const style = labelStyle(label.type);
              return (
                <button
                  key={label.id}
                  onClick={() => onSeek(label.start_ms)}
                  title={label.title}
                  className={clsx(
                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] transition-colors",
                    label.status === "done" && "opacity-45",
                  )}
                  style={{
                    color: style.color,
                    background: `${style.color}12`,
                    borderColor: `${style.color}30`,
                  }}
                >
                  <span className="tabular">{timecode(label.start_ms)}</span>
                  {style.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {note.stt_provider && !editing ? (
          <p className="text-[9.5px] text-faint/70 mt-2 tabular truncate">
            {note.stt_provider}
          </p>
        ) : null}
      </div>
    </li>
  );
}
