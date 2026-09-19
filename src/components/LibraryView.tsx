"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { Film, Scan, Search, Star, TriangleAlert } from "lucide-react";
import { Button, Chip, Empty, Panel, Spinner, useToast } from "@/components/ui";
import { FilmstripArt } from "@/components/EmptyArt";
import { timecode } from "@/lib/format";
import { api } from "@/components/project/useProject";

/**
 * Every clip in the workspace, searchable by what is in it.
 *
 * The tags come from the analysis: format, light, colour, motion, whether there
 * is music or talking, whether the camera is locked off. With an AI key the
 * model adds subject tags on top. This is the panel that answers "where is that
 * golden hour shot".
 */

export interface LibraryClip {
  id: string;
  title: string;
  project_id: string;
  project_name: string;
  role: string;
  duration_ms: number;
  created_at: number;
  source: string;
  analysis_status: string | null;
  bpm: number | null;
  scene_count: number | null;
  has_frames: number;
  tags: string[];
}

export function LibraryView({
  clips: initial,
  ffmpeg,
  canRun,
}: {
  clips: LibraryClip[];
  ffmpeg: boolean;
  canRun: boolean;
}) {
  const toast = useToast();
  const [clips, setClips] = useState(initial);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const clip of clips) {
      for (const tag of clip.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [clips]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return clips.filter((clip) => {
      const matchesText =
        !needle ||
        clip.title.toLowerCase().includes(needle) ||
        clip.project_name.toLowerCase().includes(needle) ||
        clip.tags.some((tag) => tag.includes(needle));
      const matchesTags = active.every((tag) => clip.tags.includes(tag));
      return matchesText && matchesTags;
    });
  }, [clips, query, active]);

  const analysed = clips.filter((c) => c.analysis_status === "done").length;

  function toggleTag(tag: string) {
    setActive((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
    );
  }

  async function analyse(clip: LibraryClip) {
    setBusy(clip.id);
    try {
      await api(`/api/videos/${clip.id}/analysis`, { method: "POST" });
      toast(`Analysing ${clip.title}. Tags appear when it finishes.`, "ok");
      setClips((current) =>
        current.map((c) =>
          c.id === clip.id ? { ...c, analysis_status: "running" } : c,
        ),
      );
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-5 sm:px-8 py-7 max-w-[1180px]">
      <header>
        <span className="text-eyebrow">Workspace</span>
        <h1 className="text-display text-[clamp(1.8rem,3vw,2.4rem)] mt-2">Clip library</h1>
        <p className="text-[13.5px] text-mute mt-2 max-w-[62ch] leading-relaxed">
          Every clip across every project, tagged by what the analyser measured in it.
          Search it when you need a shot rather than a project.
        </p>
      </header>

      {!ffmpeg ? (
        <Panel className="mt-5 border border-warn/25">
          <p className="px-5 py-4 text-[12.5px] text-mute leading-relaxed flex items-start gap-2.5">
            <TriangleAlert size={15} className="text-warn shrink-0 mt-0.5" />
            <span>
              Tagging needs ffmpeg. Run{" "}
              <code className="text-chalk-dim">npm install ffmpeg-static ffprobe-static</code>{" "}
              and restart, or point FFMPEG_PATH and FFPROBE_PATH at your own build.
            </span>
          </p>
        </Panel>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="relative flex-1 min-w-[220px]">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
          />
          <input
            className="field pl-9"
            placeholder="Search clips, projects or tags"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <span className="text-[11.5px] tabular text-faint">
          {shown.length} of {clips.length} clips · {analysed} analysed
        </span>
      </div>

      {tagCounts.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tagCounts.map(([tag, count]) => (
            <Chip
              key={tag}
              active={active.includes(tag)}
              onClick={() => toggleTag(tag)}
              title={`${count} clip${count === 1 ? "" : "s"}`}
            >
              {tag}
              <span className="text-faint tabular">{count}</span>
            </Chip>
          ))}
          {active.length ? (
            <button
              onClick={() => setActive([])}
              className="text-[11.5px] text-mute hover:text-chalk px-2"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <Panel className="mt-6">
          <Empty
            art={<FilmstripArt />}
            title={clips.length === 0 ? "No clips yet" : "Nothing matches that"}
            hint={
              clips.length === 0
                ? "Upload footage to a project and analyse it. Every clip you analyse turns up here with its tags."
                : "Try a different word, or clear the tag filters."
            }
          />
        </Panel>
      ) : (
        <div className="mt-5 grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {shown.map((clip) => (
            <article key={clip.id} className="glass rounded-[14px] overflow-hidden group">
              <Link
                href={`/app/projects/${clip.project_id}/walkthrough/${clip.id}`}
                className="block aspect-video relative bg-gradient-to-br from-ink-800 to-ink-950"
              >
                {clip.has_frames > 0 ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={`/api/videos/${clip.id}/frames/0`}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 size-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                  />
                ) : (
                  <span className="absolute inset-0 grid place-items-center text-faint">
                    <Film size={20} />
                  </span>
                )}
                {clip.duration_ms > 0 ? (
                  <span className="absolute bottom-2 right-2 rounded-md bg-ink-950/80 px-1.5 py-0.5 text-[10.5px] tabular text-chalk-dim">
                    {timecode(clip.duration_ms)}
                  </span>
                ) : null}
                {clip.role === "reference" ? (
                  <span className="absolute top-2 left-2 rounded-md bg-ink-950/75 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-signal inline-flex items-center gap-1">
                    <Star size={9} /> reference
                  </span>
                ) : null}
              </Link>

              <div className="px-3.5 py-3">
                <p className="text-[13px] text-chalk truncate">{clip.title}</p>
                <p className="text-[11px] text-faint mt-0.5 truncate">
                  {clip.project_name}
                  {clip.scene_count ? ` · ${clip.scene_count} shots` : ""}
                  {clip.bpm ? ` · ${Math.round(clip.bpm)} BPM` : ""}
                </p>

                {clip.tags.length ? (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {clip.tags.slice(0, 6).map((tag) => (
                      <span
                        key={tag}
                        className={clsx(
                          "text-[10px] rounded-full px-1.5 py-px border",
                          active.includes(tag)
                            ? "text-signal border-signal/40 bg-signal/10"
                            : "text-faint border-white/10",
                        )}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : clip.analysis_status === "running" ? (
                  <p className="text-[11px] text-mute mt-2 flex items-center gap-1.5">
                    <Spinner /> analysing
                  </p>
                ) : canRun ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    className="mt-2 -ml-2"
                    icon={<Scan size={12} />}
                    loading={busy === clip.id}
                    onClick={() => analyse(clip)}
                  >
                    Analyse to tag
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
