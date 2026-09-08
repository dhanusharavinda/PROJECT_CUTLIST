"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Mic, Square, Type } from "lucide-react";
import { Button, Spinner, useToast } from "@/components/ui";
import { timecode } from "@/lib/format";
import { api } from "@/components/project/useProject";

type Phase = "idle" | "arming" | "recording" | "uploading" | "thinking";

/** Ordered by preference; the first one the browser supports wins. */
const CANDIDATE_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

export function Recorder({
  projectId,
  videoId,
  getAnchorMs,
  onBeforeRecord,
  onDone,
  disabled,
  sttLabel,
  registerTrigger,
}: {
  projectId: string;
  videoId: string | null;
  /** Read at the moment recording starts — that is the frame being talked about. */
  getAnchorMs: () => number;
  onBeforeRecord?: () => void;
  onDone: (summary: { labels: number; warning?: string }) => void;
  disabled?: boolean;
  sttLabel: string | null;
  /** Lets the studio bind the R key to this recorder. */
  registerTrigger?: (toggle: () => void) => void;
}) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const startedAt = useRef(0);
  const anchor = useRef(0);

  const teardown = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    recorder.current = null;
    setLevel(0);
    setElapsed(0);
  }, []);

  useEffect(() => teardown, [teardown]);

  const submit = useCallback(
    async (blob: Blob, mime: string, durationMs: number) => {
      setPhase("uploading");
      try {
        const query = new URLSearchParams({
          anchor: String(Math.round(anchor.current)),
          audioMs: String(Math.round(durationMs)),
          mime,
        });
        if (videoId) query.set("videoId", videoId);

        const created = await api<{ note: { id: string } }>(
          `/api/projects/${projectId}/notes?${query}`,
          { method: "POST", body: blob, headers: { "Content-Type": mime } },
        );

        setPhase("thinking");
        const processed = await api<{
          labels: unknown[];
          warning?: string;
        }>(`/api/notes/${created.note.id}/process`, { method: "POST" });

        onDone({ labels: processed.labels.length, warning: processed.warning });
      } catch (err) {
        toast((err as Error).message, "error");
      } finally {
        setPhase("idle");
      }
    },
    [projectId, videoId, onDone, toast],
  );

  async function start() {
    if (phase !== "idle") return;
    setPhase("arming");
    onBeforeRecord?.();
    anchor.current = getAnchorMs();

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.current = media;

      const mimeType =
        CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = rec;
      chunks.current = [];

      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunks.current, { type });
        const duration = Date.now() - startedAt.current;
        teardown();
        if (blob.size < 900) {
          setPhase("idle");
          toast("That was too short to transcribe — hold it a moment longer.", "error");
          return;
        }
        void submit(blob, type.split(";")[0], duration);
      };

      // Live level meter. Purely cosmetic, but it is the only feedback that
      // the microphone is actually picking anything up.
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(media).connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(buffer);
        let peak = 0;
        for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128));
        setLevel(Math.min(1, peak / 70));
        setElapsed(Date.now() - startedAt.current);
        raf.current = requestAnimationFrame(tick);
      };

      startedAt.current = Date.now();
      rec.start();
      setPhase("recording");
      tick();
    } catch (err) {
      teardown();
      setPhase("idle");
      const message =
        (err as Error).name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in your browser's site settings."
          : (err as Error).message;
      toast(message, "error");
    }
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  // Re-pointed on every render so the keyboard shortcut always sees the
  // current phase without re-registering the handler upstream.
  const toggleRef = useRef<() => void>(() => {});
  useEffect(() => {
    toggleRef.current = () => {
      if (phase === "recording") stop();
      else if (phase === "idle" && !typing) void start();
    };
  });
  useEffect(() => {
    registerTrigger?.(() => toggleRef.current());
  }, [registerTrigger]);

  async function sendTyped() {
    const text = draft.trim();
    if (!text) return;
    setPhase("thinking");
    try {
      const created = await api<{ note: { id: string } }>(
        `/api/projects/${projectId}/notes`,
        {
          method: "POST",
          json: { videoId, anchorMs: Math.round(getAnchorMs()), text },
        },
      );
      const processed = await api<{ labels: unknown[] }>(
        `/api/notes/${created.note.id}/process?transcribe=0`,
        { method: "POST" },
      );
      setDraft("");
      setTyping(false);
      onDone({ labels: processed.labels.length });
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase === "uploading" || phase === "thinking";

  if (typing) {
    return (
      <div className="glass rounded-[14px] p-3.5">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-eyebrow">
            Typed note at {timecode(getAnchorMs())}
          </span>
          <button
            onClick={() => setTyping(false)}
            className="text-[11.5px] text-faint hover:text-chalk"
          >
            Cancel
          </button>
        </div>
        <textarea
          autoFocus
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendTyped();
          }}
          placeholder="Cut from here to the door slam, then whoosh into the b-roll…"
          className="field resize-y min-h-[74px] leading-relaxed"
        />
        <div className="flex items-center justify-between mt-2.5">
          <span className="text-[10.5px] text-faint">⌘/Ctrl + Enter to send</span>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={sendTyped}
            disabled={!draft.trim()}
          >
            Add note
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-[14px] p-3.5">
      <div className="flex items-center gap-3">
        <button
          onClick={phase === "recording" ? stop : start}
          disabled={disabled || busy || phase === "arming"}
          className={clsx(
            "relative size-11 shrink-0 grid place-items-center rounded-full transition-all duration-200",
            "disabled:opacity-40 disabled:pointer-events-none",
            phase === "recording"
              ? "bg-danger text-white"
              : "bg-signal text-ink-950 hover:bg-[#e2ff77]",
          )}
          aria-label={phase === "recording" ? "Stop recording" : "Record a voice note"}
        >
          {phase === "recording" ? (
            <>
              <span
                className="absolute inset-0 rounded-full border-2 border-danger/50"
                style={{ transform: `scale(${1 + level * 0.5})`, opacity: 1 - level * 0.6 }}
              />
              <Square size={14} fill="currentColor" />
            </>
          ) : busy || phase === "arming" ? (
            <Spinner />
          ) : (
            <Mic size={17} />
          )}
        </button>

        <div className="min-w-0 flex-1">
          {phase === "recording" ? (
            <>
              <div className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-danger [animation:pulse-rec_1.1s_ease-in-out_infinite]" />
                <span className="text-[13px] text-chalk tabular">
                  {timecode(elapsed, true)}
                </span>
                <span className="text-[11.5px] text-faint">
                  at {timecode(anchor.current)}
                </span>
              </div>
              <div className="flex items-end gap-[2px] h-4 mt-1.5">
                {Array.from({ length: 28 }).map((_, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-full bg-danger/70 origin-bottom transition-transform duration-75"
                    style={{
                      transform: `scaleY(${Math.max(
                        0.12,
                        level * (0.45 + Math.abs(Math.sin(i * 1.3 + elapsed / 90)) * 0.55),
                      )})`,
                      height: "100%",
                    }}
                  />
                ))}
              </div>
            </>
          ) : busy ? (
            <>
              <p className="text-[13px] text-chalk">
                {phase === "uploading" ? "Uploading…" : "Transcribing and labelling…"}
              </p>
              <div className="h-1 mt-2 rounded-full bg-white/[0.07] overflow-hidden">
                <div className="h-full w-1/3 rounded-full bg-signal skeleton" />
              </div>
            </>
          ) : (
            <>
              <p className="text-[13px] text-chalk">
                Talk over the footage
                <kbd className="ml-2 rounded border border-white/12 px-1 py-px text-[10px] text-faint">
                  R
                </kbd>
              </p>
              <p className="text-[11.5px] text-faint mt-0.5 truncate">
                {sttLabel
                  ? `${sttLabel} · pins to ${timecode(getAnchorMs())}`
                  : "No transcription key — the recording is saved, but not transcribed"}
              </p>
            </>
          )}
        </div>

        {phase === "idle" && !busy ? (
          <button
            onClick={() => setTyping(true)}
            title="Type instead"
            className="size-8 shrink-0 grid place-items-center rounded-[9px] text-faint hover:text-chalk hover:bg-white/[0.07] transition-colors"
          >
            <Type size={15} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
