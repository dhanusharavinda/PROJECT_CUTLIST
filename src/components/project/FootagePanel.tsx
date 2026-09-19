"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  Clapperboard,
  HardDriveUpload,
  Link2,
  Play,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { Button, Empty, Labeled, Modal, Spinner, useToast } from "@/components/ui";
import { FilmstripArt } from "@/components/EmptyArt";
import { bytes, timecode } from "@/lib/format";
import type { Video } from "@/lib/types";
import { api } from "./useProject";
import { DrivePicker } from "./DrivePicker";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  durationMs: number;
  thumbnailLink?: string;
}

export function FootagePanel({
  projectId,
  videos,
  canUpload,
  onChanged,
}: {
  projectId: string;
  videos: Video[];
  canUpload: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(
    null,
  );
  const [linkOpen, setLinkOpen] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);

  // Working copies are a cache, so it should be visible and releasable.
  const onDisk = videos.reduce(
    (total, clip) => total + (clip.storage_key ? clip.size_bytes : 0),
    0,
  );

  /** Read duration client-side so the timeline is correct before first play. */
  async function readDuration(file: File): Promise<number> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const probe = document.createElement("video");
      probe.preload = "metadata";
      const done = (ms: number) => {
        URL.revokeObjectURL(url);
        resolve(ms);
      };
      probe.onloadedmetadata = () =>
        done(Number.isFinite(probe.duration) ? Math.round(probe.duration * 1000) : 0);
      probe.onerror = () => done(0);
      probe.src = url;
      setTimeout(() => done(0), 8000);
    });
  }

  async function upload(file: File) {
    const duration = await readDuration(file);
    setProgress({ name: file.name, pct: 0 });

    // XHR rather than fetch: this is the one place an upload progress bar is
    // worth more than a nicer API.
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const query = new URLSearchParams({
        filename: file.name,
        mime: file.type || "video/mp4",
        duration: String(duration),
      });
      xhr.open("POST", `/api/projects/${projectId}/videos/upload?${query}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setProgress({
            name: file.name,
            pct: Math.round((event.loaded / event.total) * 100),
          });
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let message = `Upload failed (${xhr.status}).`;
        try {
          message = JSON.parse(xhr.responseText).error ?? message;
        } catch {
          /* keep the generic message */
        }
        reject(new Error(message));
      };
      xhr.onerror = () => reject(new Error("The upload was interrupted."));
      xhr.send(file);
    })
      .then(() => {
        toast(`${file.name} added`, "ok");
        onChanged();
      })
      .catch((err: Error) => toast(err.message, "error"))
      .finally(() => setProgress(null));
  }

  async function remove(video: Video) {
    if (!confirm(`Remove "${video.title}"? Its notes and instructions go too.`))
      return;
    try {
      await api(`/api/videos/${video.id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div>
      {canUpload ? (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            ref={fileInput}
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
          <Button
            variant="primary"
            icon={<Upload size={15} />}
            onClick={() => fileInput.current?.click()}
            disabled={Boolean(progress)}
          >
            Upload a clip
          </Button>
          <Button
            icon={<HardDriveUpload size={15} />}
            onClick={() => setDriveOpen(true)}
          >
            From Drive
          </Button>
          <Button icon={<Link2 size={15} />} onClick={() => setLinkOpen(true)}>
            Add a link
          </Button>
        </div>
      ) : null}

      {progress ? (
        <div className="glass-soft rounded-[12px] px-4 py-3 mb-4">
          <div className="flex items-center justify-between text-[12px] mb-2">
            <span className="text-chalk-dim truncate">{progress.name}</span>
            <span className="tabular text-faint shrink-0 ml-3">
              {progress.pct}%
            </span>
          </div>
          <div className="h-1 rounded-full bg-white/[0.07] overflow-hidden">
            <div
              className="h-full bg-signal transition-[width] duration-150"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      ) : null}

      {onDisk > 0 ? (
        <p className="text-[11px] text-faint mb-3 tabular">
          {bytes(onDisk)} of working copies on this machine for this project.
        </p>
      ) : null}

      {videos.length === 0 ? (
        <div className="glass rounded-[15px]">
          <Empty
            art={<FilmstripArt />}
            title="No footage attached"
            hint={
              canUpload
                ? "Upload a clip, pull one from Drive, or point at a URL. Then open the walkthrough and talk the editor through it."
                : "The creator hasn't attached footage yet."
            }
          />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {videos.map((video) => (
            <div
              key={video.id}
              className="glass rounded-[14px] overflow-hidden group"
            >
              <Link
                href={`/app/projects/${projectId}/walkthrough/${video.id}`}
                className="block aspect-video relative bg-gradient-to-br from-ink-800 to-ink-950"
              >
                {/* The first analysis frame, once there is one. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/videos/${video.id}/frames/0`}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                <span className="absolute inset-0 grid place-items-center">
                  <span className="size-10 rounded-full glass-deep grid place-items-center text-chalk group-hover:bg-signal group-hover:text-ink-950 transition-colors">
                    <Play size={15} className="ml-0.5" fill="currentColor" />
                  </span>
                </span>
                {video.duration_ms > 0 ? (
                  <span className="absolute bottom-2 right-2 rounded-md bg-ink-950/80 px-1.5 py-0.5 text-[10.5px] tabular text-chalk-dim">
                    {timecode(video.duration_ms)}
                  </span>
                ) : null}
                <span className="absolute top-2 left-2 rounded-md bg-ink-950/70 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-mute">
                  {video.source}
                </span>
              </Link>

              <div className="px-3.5 py-3 flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-chalk truncate">{video.title}</p>
                  <p className="text-[11px] text-faint mt-0.5 tabular truncate">
                    {video.source_name || video.mime}
                    {video.size_bytes ? ` · ${bytes(video.size_bytes)}` : ""}
                  </p>
                  <LocalState
                    video={video}
                    canUpload={canUpload}
                    onChanged={onChanged}
                  />
                </div>
                {canUpload ? (
                  <button
                    onClick={() => remove(video)}
                    className="shrink-0 size-7 grid place-items-center rounded-lg text-faint hover:text-danger hover:bg-danger/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                    aria-label={`Remove ${video.title}`}
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <LinkModal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        projectId={projectId}
        onAdded={onChanged}
      />
      <DrivePicker
        open={driveOpen}
        onClose={() => setDriveOpen(false)}
        projectId={projectId}
        onAdded={onChanged}
      />
    </div>
  );
}

function LinkModal({
  open,
  onClose,
  projectId,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/videos`, {
        method: "POST",
        json: { title: title || url.split("/").pop() || "Clip", source: "link", externalUrl: url },
      });
      setUrl("");
      setTitle("");
      onClose();
      onAdded();
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
      title="Add a clip by URL"
      description="A direct link to a video file. The browser plays it in place, so the source must allow cross-origin playback."
      width={470}
    >
      <form onSubmit={submit} className="space-y-4">
        <Labeled label="Video URL" required>
          <input
            autoFocus
            required
            type="url"
            className="field"
            placeholder="https://cdn.example.com/ep42.mp4"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Labeled>
        <Labeled label="Title">
          <input
            className="field"
            placeholder="Ep. 42 raw"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Labeled>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Attach clip
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Where a clip actually is, and what to do about it.
 *
 * A Drive clip with no local copy still plays, it just streams from Google and
 * cannot be analysed. The copy is what buys thumbnails, shot detection, beats
 * and instant scrubbing, and it can always be released again.
 */
function LocalState({
  video,
  canUpload,
  onChanged,
}: {
  video: Video;
  canUpload: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [progress, setProgress] = useState<{
    stage: string;
    copied: number;
    total: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const copying = video.local_state === "copying";

  // Only the clip being copied polls, and the queue runs one at a time.
  useEffect(() => {
    if (!copying) {
      setProgress(null);
      return;
    }
    let live = true;
    const tick = async () => {
      try {
        const data = await api<{
          state: string;
          progress: { stage: string; copied: number; total: number } | null;
        }>(`/api/videos/${video.id}/localize`);
        if (!live) return;
        setProgress(data.progress);
        if (data.state !== "copying") onChanged();
      } catch {
        /* the next tick tries again */
      }
    };
    void tick();
    const timer = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [copying, video.id, onChanged]);

  async function call(method: "POST" | "DELETE", message: string) {
    setBusy(true);
    try {
      await api(`/api/videos/${video.id}/localize`, { method });
      toast(message, "ok");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (copying) {
    const pct =
      progress && progress.total > 0
        ? Math.round((progress.copied / progress.total) * 100)
        : null;
    const label =
      progress?.stage === "preview"
        ? "Making a playable preview"
        : progress?.stage === "reading"
          ? "Reading shots and beats"
          : pct !== null
            ? `Copying ${pct}%`
            : "Copying from Drive";
    return (
      <p className="text-[11px] text-signal/90 mt-1 flex items-center gap-1.5">
        <Spinner /> {label}
      </p>
    );
  }

  if (video.local_state === "failed") {
    return (
      <div className="mt-1">
        <p className="text-[11px] text-danger leading-snug">
          {video.local_error ?? "The copy failed."}
        </p>
        {canUpload ? (
          <button
            onClick={() => call("POST", "Trying that copy again")}
            disabled={busy}
            className="text-[11px] text-chalk-dim hover:text-chalk underline underline-offset-2"
          >
            try again
          </button>
        ) : null}
      </div>
    );
  }

  if (video.storage_key) {
    return (
      <p className="text-[11px] text-faint mt-1 flex items-center gap-2">
        <span className="text-ok">
          on this machine{video.proxy_key ? ", preview made" : ""}
        </span>
        {canUpload && video.source === "drive" ? (
          <button
            onClick={() => call("DELETE", "Local copy released")}
            disabled={busy}
            className="hover:text-chalk underline underline-offset-2"
          >
            release
          </button>
        ) : null}
      </p>
    );
  }

  if (video.source === "drive") {
    return (
      <p className="text-[11px] text-faint mt-1 flex items-center gap-2">
        streaming from Drive
        {canUpload ? (
          <button
            onClick={() => call("POST", "Copying from Drive")}
            disabled={busy}
            className="text-chalk-dim hover:text-chalk underline underline-offset-2"
          >
            copy here
          </button>
        ) : null}
      </p>
    );
  }

  return null;
}
