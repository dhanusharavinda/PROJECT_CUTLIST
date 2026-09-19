"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  AlertCircle,
  Check,
  Crosshair,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { Avatar, Empty, Spinner, useToast } from "@/components/ui";
import { MicArt } from "@/components/EmptyArt";
import { relativeTime, timecode } from "@/lib/format";
import { labelStyle } from "@/lib/labelStyle";
import type { NoteWithTranscript } from "@/lib/queries";
import type { Label } from "@/lib/types";
import { api } from "@/components/project/useProject";

/** One recording plays at a time, whichever card started it. */
let nowPlaying: { audio: HTMLAudioElement; stop: () => void } | null = null;

export function NotesPanel({
  notes,
  labels,
  meId,
  canEdit,
  activeNoteId,
  onOpenNote,
  onSeek,
  onChanged,
}: {
  notes: NoteWithTranscript[];
  labels: Label[];
  meId: string;
  canEdit: boolean;
  /** The note last opened, from this list or from a dot on the marker track. */
  activeNoteId?: string | null;
  /** Move the player to where a note was recorded and put that note in focus. */
  onOpenNote: (noteId: string, ms: number, opts?: { pause?: boolean }) => void;
  onSeek: (ms: number) => void;
  onChanged: () => void;
}) {
  if (notes.length === 0) {
    return (
      <Empty
        art={<MicArt />}
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
          active={activeNoteId === note.id}
          onOpenNote={onOpenNote}
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
  active,
  onOpenNote,
  onSeek,
  onChanged,
}: {
  note: NoteWithTranscript;
  labels: Label[];
  meId: string;
  canEdit: boolean;
  active: boolean;
  onOpenNote: (noteId: string, ms: number, opts?: { pause?: boolean }) => void;
  onSeek: (ms: number) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const card = useRef<HTMLLIElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const mine = note.author_id === meId;
  const failed = note.transcribe_status === "failed";
  const pending =
    note.transcribe_status === "queued" || note.transcribe_status === "running";
  const at = timecode(note.anchor_ms);

  // Opened from the marker track: bring the card into view.
  useEffect(() => {
    if (active) card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  // Leaving the clip must not leave a recording talking in the background.
  useEffect(
    () => () => {
      const audio = audioRef.current;
      audio?.pause();
      if (audio && nowPlaying?.audio === audio) nowPlaying = null;
    },
    [],
  );

  function jump() {
    onOpenNote(note.id, note.anchor_ms);
  }

  function stopAudio() {
    const audio = audioRef.current;
    audio?.pause();
    if (audio && nowPlaying?.audio === audio) nowPlaying = null;
    setPlaying(false);
  }

  /** Plays the original recording from `fromMs` into it, with the video parked on the note. */
  function playAudio(fromMs = 0) {
    onOpenNote(note.id, note.anchor_ms, { pause: true });
    if (nowPlaying && nowPlaying.audio !== audioRef.current) nowPlaying.stop();

    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio(`/api/notes/${note.id}/audio`);
      audio.onended = stopAudio;
      audio.onerror = () => {
        stopAudio();
        toast("Could not play that recording.", "error");
      };
      audioRef.current = audio;
    }
    audio.currentTime = Math.max(0, fromMs) / 1000;
    nowPlaying = { audio, stop: stopAudio };
    setPlaying(true);
    void audio.play().catch(() => stopAudio());
  }

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
      stopAudio();
      await api(`/api/notes/${note.id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <li
      ref={card}
      aria-current={active ? "true" : undefined}
      className={clsx(
        "rounded-[12px] border overflow-hidden scroll-my-3 transition-colors",
        active
          ? "border-signal/35 bg-signal/[0.04]"
          : "border-white/[0.07] bg-white/[0.025]",
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <Avatar name={note.author_name ?? "?"} seed={note.author_id} size={20} />
        <span className="text-[11.5px] text-chalk-dim truncate">
          {mine ? "You" : (note.author_name ?? "Unknown")}
        </span>
        <button
          onClick={jump}
          title={`Jump the player to ${at}`}
          aria-label={`Jump the player to ${at}`}
          className={clsx(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 tabular text-[10.5px] transition-colors shrink-0",
            active
              ? "bg-signal/15 text-signal"
              : "text-mute hover:text-signal hover:bg-white/[0.06]",
          )}
        >
          <Crosshair size={10} aria-hidden />
          {at}
        </button>
        <span className="text-[10px] text-faint truncate">
          {relativeTime(note.created_at)}
        </span>

        <span className="ml-auto flex items-center gap-1 shrink-0">
          {note.kind === "voice" ? (
            <button
              onClick={() => (playing ? stopAudio() : playAudio())}
              title={playing ? "Stop the recording" : `Play the recording at ${at}`}
              aria-label={playing ? "Stop the recording" : `Play the recording at ${at}`}
              aria-pressed={playing}
              className={clsx(
                "size-6 grid place-items-center rounded-md hover:bg-white/[0.07]",
                playing ? "text-signal" : "text-faint hover:text-chalk",
              )}
            >
              {playing ? (
                <Pause size={11} fill="currentColor" />
              ) : (
                <Play size={11} fill="currentColor" />
              )}
            </button>
          ) : (
            <Type size={11} className="text-faint" aria-label="Typed note" />
          )}
          {canEdit && (mine || note.kind === "text") ? (
            <button
              onClick={() => {
                setDraft(note.text);
                setEditing((v) => !v);
              }}
              title="Correct the transcript"
              aria-label="Correct the transcript"
              className="size-6 grid place-items-center rounded-md text-faint hover:text-chalk hover:bg-white/[0.07]"
            >
              <Pencil size={11} />
            </button>
          ) : null}
          {canEdit && mine ? (
            <button
              onClick={remove}
              title="Delete note"
              aria-label="Delete note"
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
                aria-label="Cancel editing"
                className="size-7 grid place-items-center rounded-lg text-faint hover:text-chalk hover:bg-white/[0.07]"
              >
                <X size={13} />
              </button>
              <button
                onClick={saveText}
                disabled={busy}
                title="Save and re-label"
                aria-label="Save and re-label"
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
          <button
            type="button"
            onClick={jump}
            title={`Jump the player to ${at}`}
            className="block w-full text-left rounded-md hover:bg-white/[0.035] transition-colors"
          >
            <span className="block text-[12.5px] text-chalk-dim leading-[1.6] whitespace-pre-wrap">
              {note.text}
            </span>
          </button>
        ) : (
          <p className="text-[12px] text-faint italic">Empty note.</p>
        )}

        {note.segments.length > 1 && !editing ? (
          <details className="mt-2 group">
            <summary className="text-[10.5px] text-faint cursor-pointer hover:text-mute list-none">
              {note.segments.length} timed segments
            </summary>
            <ul className="mt-1.5 space-y-0.5 border-l border-white/[0.08] pl-1.5">
              {note.segments.map((segment) => {
                const offset = timecode(segment.start_ms);
                return (
                  <li key={segment.id}>
                    <button
                      type="button"
                      onClick={() =>
                        note.kind === "voice" ? playAudio(segment.start_ms) : jump()
                      }
                      title={
                        note.kind === "voice"
                          ? `Play this part of the recording (${offset} in)`
                          : `Jump the player to ${at}`
                      }
                      className="w-full text-left rounded-md px-1 py-0.5 text-[11.5px] text-mute leading-snug hover:text-chalk-dim hover:bg-white/[0.04] transition-colors"
                    >
                      <span className="tabular text-faint mr-1.5">+{offset}</span>
                      {segment.text}
                    </button>
                  </li>
                );
              })}
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
                  aria-label={label.title}
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
