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
import { bytes, timecode } from "@/lib/format";
import type { Video } from "@/lib/types";
import { api } from "./useProject";

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

      {videos.length === 0 ? (
        <div className="glass rounded-[15px]">
          <Empty
            icon={<Clapperboard size={18} />}
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
                  <p className="text-[11px] text-faint mt-0.5 tabular">
                    {video.size_bytes ? bytes(video.size_bytes) : video.mime}
                  </p>
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
      <DriveModal
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
      description="A direct link to a video file. The browser plays it in place — the source must allow cross-origin playback."
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

function DriveModal({
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
  const [state, setState] = useState<{
    loading: boolean;
    connected: boolean;
    available: boolean;
    files: DriveFile[];
    error?: string;
  }>({ loading: false, connected: false, available: false, files: [] });
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState<string | null>(null);

  const load = useCallback(async (search = "") => {
    setState((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const data = await api<{
        connected: boolean;
        available: boolean;
        files: DriveFile[];
      }>(`/api/integrations/drive?q=${encodeURIComponent(search)}`);
      setState({ loading: false, ...data });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, []);

  // Fetch on open, not on mount — most sessions never open this.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function importFile(file: DriveFile) {
    setImporting(file.id);
    try {
      await api(`/api/projects/${projectId}/videos`, {
        method: "POST",
        json: {
          title: file.name.replace(/\.[a-z0-9]{2,5}$/i, ""),
          source: "drive",
          driveFileId: file.id,
          mime: file.mimeType,
          sizeBytes: file.size,
          durationMs: file.durationMs,
        },
      });
      toast(`${file.name} attached`, "ok");
      onAdded();
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setImporting(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pull from Google Drive"
      description="Clips stream straight from your Drive — nothing is copied onto this machine."
      width={560}
    >
      {state.loading && state.files.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-[10px] skeleton" />
          ))}
        </div>
      ) : state.error ? (
        <p className="text-[12.5px] text-danger bg-danger/8 border border-danger/20 rounded-[10px] px-3 py-2.5">
          {state.error}
        </p>
      ) : !state.available ? (
        <Empty
          title="Drive isn't set up on this instance"
          hint="Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local, then restart. The README has the exact steps."
        />
      ) : !state.connected ? (
        <Empty
          title="No Drive account connected"
          hint="Connect the workspace to a Google account to browse footage from here."
          action={
            <Link href="/app/settings">
              <Button variant="primary">Open settings</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
            />
            <input
              className="field pl-9"
              placeholder="Search your Drive…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load(query)}
            />
          </div>

          {state.files.length === 0 ? (
            <Empty title="No video files found" hint="Try a different search." />
          ) : (
            <ul className="space-y-1 max-h-[46vh] overflow-y-auto -mx-1 px-1">
              {state.files.map((file) => (
                <li key={file.id}>
                  <button
                    onClick={() => importFile(file)}
                    disabled={Boolean(importing)}
                    className={clsx(
                      "w-full flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors",
                      "hover:bg-white/[0.06] disabled:opacity-50",
                    )}
                  >
                    <Clapperboard size={15} className="text-faint shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-chalk truncate">
                        {file.name}
                      </span>
                      <span className="block text-[11px] text-faint tabular">
                        {file.size ? bytes(file.size) : "—"}
                        {file.durationMs
                          ? ` · ${timecode(file.durationMs)}`
                          : ""}
                      </span>
                    </span>
                    {importing === file.id ? <Spinner /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
