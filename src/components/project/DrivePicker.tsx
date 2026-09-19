"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import {
  ChevronLeft,
  Clapperboard,
  Folder,
  Search,
  Check,
} from "lucide-react";
import { Button, Empty, Modal, Spinner, useToast } from "@/components/ui";
import { bytes, timecode } from "@/lib/format";
import { api } from "./useProject";

/**
 * Folder first, then clips.
 *
 * One shoot in one Drive folder is the whole identity story: the folder is what
 * the editor is sent, and every clip attached from it keeps its real filename
 * and its Drive link, so "shot 3" always resolves to a file they can open.
 */

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  durationMs: number;
  webViewLink?: string;
  parents?: string[];
}

interface DriveFolder {
  id: string;
  name: string;
  webViewLink?: string;
}

export function DrivePicker({
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
  const [ready, setReady] = useState<{ connected: boolean; available: boolean }>({
    connected: false,
    available: false,
  });
  const [folder, setFolder] = useState<DriveFolder | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFolders = useCallback(async (search = "") => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{
        connected: boolean;
        available: boolean;
        folders: DriveFolder[];
      }>(`/api/integrations/drive/folders?q=${encodeURIComponent(search)}`);
      setReady({ connected: data.connected, available: data.available });
      setFolders(data.folders ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFiles = useCallback(
    async (target: DriveFolder | null, search = "", pageToken?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (target) params.set("folderId", target.id);
        if (search) params.set("q", search);
        if (pageToken) params.set("pageToken", pageToken);

        const data = await api<{
          connected: boolean;
          available: boolean;
          files: DriveFile[];
          nextPageToken?: string;
        }>(`/api/integrations/drive?${params}`);

        setReady({ connected: data.connected, available: data.available });
        setFiles((current) =>
          pageToken ? [...current, ...(data.files ?? [])] : (data.files ?? []),
        );
        setNextPage(data.nextPageToken ?? null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Fetch on open, not on mount; most sessions never open this.
  useEffect(() => {
    if (!open) return;
    setFolder(null);
    setFiles([]);
    setPicked(new Set());
    setQuery("");
    void loadFolders();
  }, [open, loadFolders]);

  function openFolder(target: DriveFolder) {
    setFolder(target);
    setPicked(new Set());
    setQuery("");
    void loadFiles(target);
  }

  function back() {
    setFolder(null);
    setFiles([]);
    setPicked(new Set());
    setQuery("");
    void loadFolders();
  }

  function toggle(fileId: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }

  async function attach() {
    const chosen = files.filter((file) => picked.has(file.id));
    if (chosen.length === 0) return;

    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/videos`, {
        method: "POST",
        json: {
          footageUrl: folder?.webViewLink,
          items: chosen.map((file) => ({
            title: file.name.replace(/\.[a-z0-9]{2,5}$/i, ""),
            source: "drive" as const,
            driveFileId: file.id,
            mime: file.mimeType,
            sizeBytes: file.size,
            durationMs: file.durationMs,
            sourceName: file.name,
            shareUrl: file.webViewLink,
            driveParentId: folder?.id ?? file.parents?.[0],
          })),
        },
      });

      toast(
        `${chosen.length} clip${chosen.length === 1 ? "" : "s"} attached. Copying them now.`,
        "ok",
      );
      onAdded();
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const searching = query.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={folder ? folder.name : "Pick the folder for this reel"}
      description={
        folder
          ? "Tick the clips for this reel. Cutlist copies each one to this machine so it can read the shots, the beats and the silences, and so scrubbing is instant. Your Drive originals are never changed."
          : "Keep one shoot in one folder. That folder is what your editor gets sent, and every clip you attach from it keeps its Drive filename and link."
      }
      width={640}
    >
      {!ready.available && !loading && !error ? (
        <Empty
          title="Drive is not set up on this instance"
          hint="Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local, then restart. The README has the exact steps."
        />
      ) : !ready.connected && !loading && !error ? (
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
          <div className="flex items-center gap-2">
            {folder ? (
              <button
                onClick={back}
                className="shrink-0 size-9 grid place-items-center rounded-[10px] text-mute hover:text-chalk hover:bg-white/[0.06] transition-colors"
                aria-label="Back to folders"
              >
                <ChevronLeft size={16} />
              </button>
            ) : null}

            <label className="relative flex-1">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
              />
              <input
                className="field pl-9"
                placeholder={folder ? "Search clips in this folder" : "Search folders"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if (folder) void loadFiles(folder, query);
                  else void loadFolders(query);
                }}
              />
            </label>
          </div>

          {error ? (
            <p className="text-[12.5px] text-danger bg-danger/8 border border-danger/20 rounded-[10px] px-3 py-2.5">
              {error}
            </p>
          ) : null}

          {loading && files.length === 0 && folders.length === 0 ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-14 rounded-[10px] skeleton" />
              ))}
            </div>
          ) : folder ? (
            files.length === 0 ? (
              <Empty
                title="No video files here"
                hint={
                  searching
                    ? "Nothing in this folder matches that."
                    : "This folder has no videos in it. Go back and pick another."
                }
              />
            ) : (
              <>
                <ul className="space-y-1 max-h-[44vh] overflow-y-auto -mx-1 px-1">
                  {files.map((file) => {
                    const on = picked.has(file.id);
                    return (
                      <li key={file.id}>
                        <button
                          onClick={() => toggle(file.id)}
                          aria-pressed={on}
                          className={clsx(
                            "w-full flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-left border transition-colors",
                            on
                              ? "border-signal/45 bg-signal/[0.06]"
                              : "border-transparent hover:bg-white/[0.05]",
                          )}
                        >
                          <span
                            className={clsx(
                              "shrink-0 size-[18px] grid place-items-center rounded-[6px] border transition-colors",
                              on
                                ? "bg-signal border-signal text-ink-950"
                                : "border-white/20 text-transparent",
                            )}
                          >
                            <Check size={11} strokeWidth={3} />
                          </span>

                          {/* Google's own thumbnail, proxied with the workspace token. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/integrations/drive/thumb?fileId=${encodeURIComponent(file.id)}`}
                            alt=""
                            loading="lazy"
                            className="h-10 w-[60px] shrink-0 rounded-[6px] object-cover bg-ink-800"
                            onError={(e) => {
                              e.currentTarget.style.visibility = "hidden";
                            }}
                          />

                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] text-chalk truncate">
                              {file.name}
                            </span>
                            <span className="block text-[11px] text-faint tabular">
                              {file.size ? bytes(file.size) : "-"}
                              {file.durationMs ? ` · ${timecode(file.durationMs)}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {nextPage ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    loading={loading}
                    onClick={() => void loadFiles(folder, query, nextPage)}
                  >
                    Load more
                  </Button>
                ) : null}

                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="text-[11.5px] text-faint">
                    {picked.size > 0
                      ? `${picked.size} selected`
                      : "Nothing selected yet"}
                  </span>
                  <Button
                    variant="primary"
                    loading={busy}
                    disabled={picked.size === 0}
                    onClick={attach}
                  >
                    Attach {picked.size || ""} clip{picked.size === 1 ? "" : "s"}
                  </Button>
                </div>
              </>
            )
          ) : folders.length === 0 ? (
            <Empty
              title="No folders found"
              hint={
                searching
                  ? "Nothing matches that name."
                  : "Make a folder in Drive for this shoot, put the clips in it, then come back."
              }
            />
          ) : (
            <ul className="space-y-1 max-h-[46vh] overflow-y-auto -mx-1 px-1">
              {folders.map((entry) => (
                <li key={entry.id}>
                  <button
                    onClick={() => openFolder(entry)}
                    className="w-full flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-white/[0.06] transition-colors"
                  >
                    <Folder size={16} className="text-signal/70 shrink-0" />
                    <span className="min-w-0 flex-1 text-[13px] text-chalk truncate">
                      {entry.name}
                    </span>
                    <Clapperboard size={13} className="text-faint shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {loading && (files.length > 0 || folders.length > 0) ? (
            <p className="text-[11.5px] text-mute flex items-center gap-2">
              <Spinner /> Loading
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
