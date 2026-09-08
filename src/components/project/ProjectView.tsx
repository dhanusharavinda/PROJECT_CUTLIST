"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  ClipboardList,
  Download,
  Film,
  ListChecks,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button, Meter, Segmented, useToast } from "@/components/ui";
import { PROJECT_STATUS_STYLE } from "@/lib/labelStyle";
import { shortDate } from "@/lib/format";
import type { ProjectDetail } from "@/lib/queries";
import type { ProjectStatus } from "@/lib/types";
import { api, useProject } from "./useProject";
import { BriefForm } from "./BriefForm";
import { FootagePanel } from "./FootagePanel";
import { CutList } from "./CutList";
import { ReviewPanel } from "./ReviewPanel";
import { Room } from "./Room";

type Tab = "brief" | "footage" | "cutlist" | "review";

export function ProjectView({ initial }: { initial: ProjectDetail }) {
  const router = useRouter();
  const toast = useToast();
  const { project: state, presence, connection, refresh } = useProject(initial);
  const [tab, setTab] = useState<Tab>(
    initial.videos.length === 0
      ? "brief"
      : initial.labels.length > 0
        ? "cutlist"
        : "footage",
  );
  const [exportOpen, setExportOpen] = useState(false);

  const { project, capabilities, brief, videos, labels } = state;
  const status = PROJECT_STATUS_STYLE[project.status] ?? PROJECT_STATUS_STYLE.briefing;
  const openCount = labels.filter((l) => ["open", "doing"].includes(l.status)).length;
  const labelTitles = useMemo(
    () => new Map(labels.map((l) => [l.id, l.title])),
    [labels],
  );
  const overdue =
    project.due_at && project.due_at < Date.now() && project.status !== "delivered";

  async function setStatus(next: ProjectStatus) {
    try {
      await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        json: { status: next },
      });
      refresh();
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function remove() {
    if (
      !confirm(
        `Delete "${project.name}"? Footage, notes, transcripts and the cut list all go with it.`,
      )
    )
      return;
    try {
      await api(`/api/projects/${project.id}`, { method: "DELETE" });
      router.push("/app");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_326px] lg:h-dvh">
      <div className="min-w-0 lg:overflow-y-auto">
        <header className="px-5 sm:px-8 pt-7 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 mb-2">
                <select
                  value={project.status}
                  onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                  disabled={!capabilities.canLabel}
                  className="appearance-none cursor-pointer rounded-full border px-2.5 py-[3px] text-[11px] font-medium bg-transparent disabled:cursor-default"
                  style={{
                    color: status.color,
                    background: `${status.color}14`,
                    borderColor: `${status.color}33`,
                  }}
                >
                  {Object.entries(PROJECT_STATUS_STYLE).map(([value, meta]) => (
                    <option key={value} value={value}>
                      {meta.label}
                    </option>
                  ))}
                </select>

                {project.due_at ? (
                  <span
                    className={clsx(
                      "text-[11.5px] tabular",
                      overdue ? "text-danger" : "text-faint",
                    )}
                  >
                    {overdue ? "overdue · " : "due "}
                    {shortDate(project.due_at)}
                  </span>
                ) : null}
              </div>

              <h1 className="text-display text-[clamp(1.7rem,3vw,2.3rem)] leading-tight">
                {project.name}
              </h1>
              {project.summary ? (
                <p className="text-[13.5px] text-mute mt-2 max-w-[64ch] leading-relaxed">
                  {project.summary}
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="relative">
                <Button
                  icon={<Download size={14} />}
                  onClick={() => setExportOpen((v) => !v)}
                >
                  Export
                </Button>
                {exportOpen ? (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setExportOpen(false)}
                    />
                    <div className="absolute right-0 top-[calc(100%+6px)] z-20 glass-deep rounded-[11px] p-1.5 w-[188px] animate-rise">
                      {[
                        ["md", "Markdown", "for the editor's notes"],
                        ["csv", "CSV", "for a spreadsheet"],
                        ["json", "JSON", "for scripting"],
                      ].map(([format, label, hint]) => (
                        <a
                          key={format}
                          href={`/api/projects/${project.id}/export?format=${format}`}
                          onClick={() => setExportOpen(false)}
                          className="block rounded-[8px] px-2.5 py-2 hover:bg-white/[0.06] transition-colors"
                        >
                          <span className="block text-[12.5px] text-chalk">
                            {label}
                          </span>
                          <span className="block text-[10.5px] text-faint">
                            {hint}
                          </span>
                        </a>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>

              {videos.length > 0 ? (
                <Link href={`/app/projects/${project.id}/walkthrough/${videos[0].id}`}>
                  <Button variant="primary" icon={<Film size={14} />}>
                    Open walkthrough
                  </Button>
                </Link>
              ) : null}

              {capabilities.canDelete ? (
                <button
                  onClick={remove}
                  title="Delete project"
              aria-label="Delete project"
                  className="size-9.5 grid place-items-center rounded-[10px] text-faint hover:text-danger hover:bg-danger/10 transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-6">
            <div className="flex items-center gap-2 min-w-[190px]">
              <span className="text-[11px] text-faint w-9">Brief</span>
              <Meter value={brief.completeness} className="flex-1" />
              <span className="text-[11px] tabular text-faint w-8 text-right">
                {brief.completeness}%
              </span>
            </div>
            <span className="text-[11.5px] text-faint tabular">
              {videos.length} clip{videos.length === 1 ? "" : "s"}
            </span>
            <span className="text-[11.5px] text-faint tabular">
              {state.notes.length} note{state.notes.length === 1 ? "" : "s"}
            </span>
            <span
              className={clsx(
                "text-[11.5px] tabular",
                openCount ? "text-chalk-dim" : "text-faint",
              )}
            >
              {openCount} open instruction{openCount === 1 ? "" : "s"}
            </span>
          </div>

          <div className="mt-6">
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "brief", label: <><ClipboardList size={13} /> Brief</> },
                { value: "footage", label: <><Film size={13} /> Footage</>, count: videos.length },
                { value: "cutlist", label: <><ListChecks size={13} /> Cut list</>, count: openCount },
                { value: "review", label: <><Sparkles size={13} /> Review</> },
              ]}
            />
          </div>
        </header>

        <div className="px-5 sm:px-8 pb-12">
          {tab === "brief" ? (
            <BriefForm
              key={brief.updated_at}
              projectId={project.id}
              initial={brief.payload}
              canEdit={capabilities.canEditBrief}
            />
          ) : null}

          {tab === "footage" ? (
            <FootagePanel
              projectId={project.id}
              videos={videos}
              canUpload={capabilities.canUpload}
              onChanged={() => {
                refresh();
                router.refresh();
              }}
            />
          ) : null}

          {tab === "cutlist" ? (
            <CutList
              projectId={project.id}
              labels={labels}
              videos={videos}
              canEdit={capabilities.canLabel}
              canChat={capabilities.canChat}
              messages={state.messages}
              meId={state.me.id}
              onChanged={refresh}
            />
          ) : null}

          {tab === "review" ? (
            <ReviewPanel
              projectId={project.id}
              suggestion={state.suggestion}
              canRun={capabilities.canRunAi}
              hasLlm={state.ai.llm}
              onChanged={refresh}
            />
          ) : null}
        </div>
      </div>

      <aside className="glass-soft lg:h-dvh lg:border-l border-white/[0.06] flex flex-col min-h-[420px]">
        <Room
          projectId={project.id}
          messages={state.messages}
          presence={presence}
          connection={connection}
          canChat={capabilities.canChat}
          meId={state.me.id}
          labelTitles={labelTitles}
          className="flex-1"
        />
      </aside>
    </div>
  );
}
