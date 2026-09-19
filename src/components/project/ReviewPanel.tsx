"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  ArrowUpRight,
  HelpCircle,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button, Chip, Empty, Panel, PanelHeader, Spinner, useToast } from "@/components/ui";
import { labelStyle } from "@/lib/labelStyle";
import { relativeTime, timecode } from "@/lib/format";
import type { SuggestionPayload } from "@/lib/types";
import type { EditGraph } from "@/lib/graph/build";
import { api } from "./useProject";

type StateTab = "footage" | "plan" | "cutlist" | "history";

export function ReviewPanel({
  projectId,
  suggestion,
  canRun,
  hasLlm,
  activeVideoId,
  onChanged,
  onNavigate,
  stateKey,
}: {
  projectId: string;
  suggestion: { payload: string; model: string; created_at: number } | null;
  canRun: boolean;
  hasLlm: boolean;
  activeVideoId?: string | null;
  onChanged: () => void;
  /** Where each count lives. Without it the rows link to the project page. */
  onNavigate?: (tab: StateTab) => void;
  /** Any string that changes when the edit does; the state block refetches on it. */
  stateKey?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  let payload: SuggestionPayload | null = null;
  try {
    payload = suggestion ? (JSON.parse(suggestion.payload) as SuggestionPayload) : null;
  } catch {
    payload = null;
  }

  async function run() {
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/suggest`, { method: "POST" });
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function adopt(item: SuggestionPayload["items"][number]) {
    setAdding(item.title);
    try {
      await api(`/api/projects/${projectId}/labels`, {
        method: "POST",
        json: {
          type: item.type,
          title: item.title,
          detail: item.rationale,
          startMs: item.start_ms ?? 0,
          priority: item.priority ?? "normal",
          videoId: activeVideoId ?? null,
        },
      });
      toast("Added to the cut list", "ok");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setAdding(null);
    }
  }

  return (
    <div>
      <EditState projectId={projectId} stateKey={stateKey} onNavigate={onNavigate} />

      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-[14.5px] font-semibold text-chalk">
            Second pair of eyes
          </h3>
          <p className="text-[12.5px] text-mute mt-1 max-w-[56ch] leading-relaxed">
            Reads the brief, every transcript and the whole cut list together,
            then says what is missing rather than repeating what you already
            asked for.
          </p>
        </div>
        {canRun ? (
          <Button
            variant={payload ? "ghost" : "primary"}
            icon={payload ? <RefreshCw size={14} /> : <Sparkles size={14} />}
            loading={busy}
            onClick={run}
          >
            {payload ? "Run again" : "Run review"}
          </Button>
        ) : null}
      </div>

      {!hasLlm ? (
        <p className="mb-4 text-[12.5px] text-warn bg-warn/[0.07] border border-warn/20 rounded-[11px] px-3.5 py-2.5 leading-relaxed">
          No language-model key is connected, so this runs a rules-based pass
          over your brief and cut list instead of a real read. Add a key in
          Settings → AI providers.
        </p>
      ) : null}

      {!payload ? (
        <div className="glass rounded-[15px]">
          <Empty
            icon={<Sparkles size={17} />}
            title="No review yet"
            hint="Run it once the brief is filled in and you've recorded a few notes. That's when it has something to say."
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="glass rounded-[15px] p-5">
            <p className="text-display text-[19px] leading-snug text-chalk">
              {payload.headline}
            </p>
            {payload.read ? (
              <p className="text-[13px] text-mute mt-3 leading-[1.65]">
                {payload.read}
              </p>
            ) : null}
            <p className="text-[10.5px] text-faint mt-4 flex items-center gap-2">
              <span className="tabular">{suggestion?.model}</span>
              <span className="size-[3px] rounded-full bg-faint/50" />
              <span>{relativeTime(suggestion!.created_at)}</span>
            </p>
          </div>

          {payload.items.length ? (
            <div className="glass rounded-[15px] overflow-hidden">
              <div className="px-5 pt-4 pb-3">
                <span className="text-eyebrow">Suggested</span>
              </div>
              <div className="rule-x" />
              <ul className="divide-y divide-white/[0.05]">
                {payload.items.map((item, index) => {
                  const style = labelStyle(item.type);
                  return (
                    <li key={`${item.title}-${index}`} className="px-5 py-3.5 group">
                      <div className="flex items-start gap-3">
                        <span
                          className="mt-1.5 size-1.5 rounded-full shrink-0"
                          style={{ background: style.color }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] text-chalk leading-snug">
                            {item.title}
                          </p>
                          <p className="text-[12px] text-mute mt-1.5 leading-relaxed">
                            {item.rationale}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                            <Chip color={style.color}>{style.label}</Chip>
                            {item.start_ms !== undefined ? (
                              <Chip>
                                <span className="tabular">
                                  {timecode(item.start_ms)}
                                </span>
                              </Chip>
                            ) : null}
                            {item.priority === "high" ? (
                              <Chip color="#ff6b57">high</Chip>
                            ) : null}
                            {item.effort ? <Chip>{item.effort}</Chip> : null}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          icon={<Plus size={13} />}
                          loading={adding === item.title}
                          onClick={() => adopt(item)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        >
                          Add
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="grid sm:grid-cols-2 gap-4">
            <ListCard
              icon={<AlertTriangle size={13} className="text-warn" />}
              title="Watch out for"
              items={payload.risks}
              empty="Nothing flagged."
            />
            <ListCard
              icon={<HelpCircle size={13} className="text-mark-motion" />}
              title="Ask the creator"
              items={payload.gaps}
              empty="No open questions."
            />
          </div>
        </div>
      )}
    </div>
  );
}

type CompactGraph = Pick<
  EditGraph,
  "project" | "instructions" | "recommendations" | "questions" | "unresolved"
>;

interface StateRow {
  key: string;
  label: string;
  count: number;
  hint: string;
  tab: StateTab;
  where: string;
  /** Listed in full under the row: conflicts, missing links. */
  items?: string[];
  tone?: "warn" | "danger" | "ok";
}

/**
 * State of the edit: six quiet counts read from the EditGraph, each pointing
 * at where it lives. Nothing here changes anything.
 */
function EditState({
  projectId,
  stateKey,
  onNavigate,
}: {
  projectId: string;
  stateKey?: string;
  onNavigate?: (tab: StateTab) => void;
}) {
  const [graph, setGraph] = useState<CompactGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ graph: CompactGraph }>(
        `/api/projects/${projectId}/graph?compact=1`,
      );
      setGraph(res.graph);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Refetch whenever the project's edit state changes under us.
  useEffect(() => {
    void load();
  }, [load, stateKey]);

  let rows: StateRow[] = [];
  if (graph) {
    const u = graph.unresolved;
    const done = graph.instructions.filter((i) => i.status === "done").length;
    const approvedWaiting = graph.recommendations.filter((r) => r.status === "approved").length;
    const editorHolds =
      graph.project.owner_state === "human_editing" ||
      graph.project.owner_state === "ready_for_human";
    const unanswered = graph.questions.filter((q) => !q.answered);

    rows = [
      {
        key: "completed",
        label: "Completed",
        count: done,
        hint: done === 1 ? "instruction done" : "instructions done",
        tab: "cutlist",
        where: "Cut list",
        tone: "ok",
      },
      {
        key: "unresolved",
        label: "Unresolved",
        count: u.open_instructions,
        hint: u.open_instructions === 1 ? "instruction still open" : "instructions still open",
        tab: "cutlist",
        where: "Cut list",
      },
      {
        key: "conflict",
        label: "Conflict",
        count: u.conflicts.length,
        hint:
          u.conflicts.length === 0
            ? "nothing pulls against a rule or another instruction"
            : "instructions pulling against each other or against your rules",
        tab: "cutlist",
        where: "Cut list",
        items: u.conflicts,
        tone: u.conflicts.length ? "danger" : undefined,
      },
      {
        key: "missing",
        label: "Missing",
        count: u.missing_links.length,
        hint:
          u.missing_links.length === 0
            ? "every clip the packet points at can be reached"
            : "links the packet cannot point at",
        tab: "footage",
        where: "Footage",
        items: u.missing_links,
        tone: u.missing_links.length ? "warn" : undefined,
      },
      {
        key: "needs_creator",
        label: "Needs creator",
        count: u.proposed_recommendations + u.needs_review + u.unanswered_questions,
        hint: [
          `${u.proposed_recommendations} proposed`,
          `${u.needs_review} parked for review`,
          `${u.unanswered_questions} unanswered question${u.unanswered_questions === 1 ? "" : "s"}`,
        ].join(", "),
        tab: unanswered.length && !u.proposed_recommendations && !u.needs_review ? "cutlist" : "plan",
        where: unanswered.length && !u.proposed_recommendations && !u.needs_review ? "Cut list" : "Plan",
        items: unanswered.map((q) => `${q.author ?? "Someone"} asked: ${q.body}`),
        tone: u.proposed_recommendations + u.needs_review + u.unanswered_questions ? "warn" : undefined,
      },
      {
        key: "needs_editor",
        label: "Needs editor",
        count: approvedWaiting + (editorHolds ? u.open_instructions : 0),
        hint: editorHolds
          ? `${approvedWaiting} approved but not yet an instruction, ${u.open_instructions} open with the editor`
          : `${approvedWaiting} approved but not yet made an instruction`,
        tab: approvedWaiting && !editorHolds ? "plan" : "cutlist",
        where: approvedWaiting && !editorHolds ? "Plan" : "Cut list",
      },
      {
        key: "ai_suggestion",
        label: "AI suggestion",
        count: u.proposed_recommendations,
        hint: u.proposed_recommendations === 1 ? "proposed, not yet decided" : "proposed, not yet decided",
        tab: "plan",
        where: "Plan",
      },
    ];
  }

  return (
    <Panel className="mb-5">
      <PanelHeader
        eyebrow="Read only"
        title="State of the edit"
        action={
          <button
            onClick={() => void load()}
            aria-label="Refresh the state of the edit"
            title="Refresh"
            className="size-8 grid place-items-center rounded-[8px] text-faint hover:text-chalk hover:bg-white/[0.06] transition-colors"
          >
            {loading ? <Spinner /> : <RefreshCw size={13} />}
          </button>
        }
      />
      <div className="px-5 pb-4">
        {error ? (
          <p className="text-[12.5px] text-danger leading-relaxed">{error}</p>
        ) : !graph ? (
          <div className="space-y-2" aria-busy>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-7 rounded-[8px] skeleton" />
            ))}
          </div>
        ) : (
          <dl className="divide-y divide-white/[0.05]">
            {rows.map((row) => {
              const color =
                row.count === 0
                  ? "var(--color-faint)"
                  : row.tone === "danger"
                    ? "#ff6b57"
                    : row.tone === "warn"
                      ? "#ffc857"
                      : row.tone === "ok"
                        ? "#5fd3b0"
                        : "var(--color-chalk)";
              return (
                <div key={row.key} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <dt className="text-eyebrow w-[104px] shrink-0">{row.label}</dt>
                    <dd className="flex items-baseline gap-2 min-w-0 flex-1 flex-wrap">
                      <span className="text-[15px] tabular leading-none" style={{ color }}>
                        {row.count}
                      </span>
                      <span className="text-[11.5px] text-mute leading-snug">{row.hint}</span>
                    </dd>
                    {onNavigate ? (
                      <button
                        onClick={() => onNavigate(row.tab)}
                        className="text-[11px] text-faint hover:text-signal inline-flex items-center gap-0.5 transition-colors shrink-0"
                      >
                        {row.where}
                        <ArrowUpRight size={11} />
                      </button>
                    ) : (
                      <Link
                        href={`/app/projects/${projectId}`}
                        className="text-[11px] text-faint hover:text-signal inline-flex items-center gap-0.5 transition-colors shrink-0"
                      >
                        {row.where}
                        <ArrowUpRight size={11} />
                      </Link>
                    )}
                  </div>
                  {row.items && row.items.length ? (
                    <ul className="mt-1.5 ml-0 sm:ml-[116px] space-y-1">
                      {row.items.map((item, index) => (
                        <li
                          key={index}
                          className={clsx(
                            "text-[12px] leading-relaxed pl-2.5 border-l",
                            row.tone === "danger"
                              ? "text-chalk-dim border-danger/40"
                              : "text-mute border-white/10",
                          )}
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </dl>
        )}
      </div>
    </Panel>
  );
}

function ListCard({
  icon,
  title,
  items,
  empty,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <div className="glass rounded-[15px] p-5">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-[12.5px] font-medium text-chalk">{title}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] text-faint">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li
              key={index}
              className="text-[12.5px] text-mute leading-relaxed pl-3 border-l border-white/10"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
