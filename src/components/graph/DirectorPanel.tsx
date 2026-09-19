"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Brain, Lock, Sparkles, Wand2 } from "lucide-react";
import { Button, Panel, PanelHeader, useToast } from "@/components/ui";
import { RecommendationRow } from "@/components/graph/RecommendationRow";
import { api } from "@/components/project/useProject";
import type { Recommendation } from "@/lib/graph/recommendations";
import type { StyleMemory } from "@/lib/director/memory";

/**
 * The creative director, at project level.
 *
 * One button reads the whole project (brief, template, rules, every shot,
 * every transcript, every decision already made, a handful of stills) and
 * proposes. One text field asks for a revision in plain words: the AI first
 * turns the sentence into a scope, then only that part of the edit is opened
 * up again. Whatever it says lands as suggestions; nothing is applied.
 *
 * Project-wide suggestions (no clip attached) are listed here. Per-clip ones
 * appear under their clip in the plan below.
 */

const EXAMPLES = [
  "Make the middle faster but leave the hook alone",
  "Tighten the close, keep everything else",
  "Rethink the music choice only",
];

export function DirectorPanel({
  projectId,
  recommendations,
  aiAvailable,
  analysedCount,
  canRun,
  canDecide,
  onChanged,
}: {
  projectId: string;
  recommendations: Recommendation[];
  aiAvailable: boolean;
  analysedCount: number;
  canRun: boolean;
  canDecide: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [running, setRunning] = useState<"direct" | "revise" | null>(null);
  const [request, setRequest] = useState("");
  const [lastPlan, setLastPlan] = useState<{ modify: string[]; lock: string[]; summary: string } | null>(null);
  const [headline, setHeadline] = useState<string | null>(null);
  const [memory, setMemory] = useState<StyleMemory | null>(null);

  // What the director will read about this creator before it proposes.
  useEffect(() => {
    let live = true;
    api<{ memory: StyleMemory }>(`/api/projects/${projectId}/director`)
      .then((res) => {
        if (live) setMemory(res.memory);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [projectId, recommendations]);

  const projectWide = useMemo(
    () => recommendations.filter((r) => r.video_id === null && r.status !== "superseded"),
    [recommendations],
  );
  const undecided = recommendations.filter((r) => r.status === "proposed").length;

  async function direct() {
    setRunning("direct");
    try {
      const res = await api<{ headline: string; created: Recommendation[]; model: string }>(
        `/api/projects/${projectId}/director`,
        { method: "POST" },
      );
      setHeadline(res.headline || null);
      setLastPlan(null);
      onChanged();
      const fresh = res.created.filter((r) => r.status === "proposed").length;
      toast(`${fresh} suggestion${fresh === 1 ? "" : "s"} from ${res.model}. Nothing was applied.`, "ok");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setRunning(null);
    }
  }

  async function revise(event: React.FormEvent) {
    event.preventDefault();
    if (request.trim().length < 3) return;
    setRunning("revise");
    try {
      const res = await api<{
        plan: { modify: string[]; lock: string[]; summary: string };
        headline: string;
        created: Recommendation[];
      }>(`/api/projects/${projectId}/director/revise`, { method: "POST", json: { request } });
      setLastPlan(res.plan);
      setHeadline(res.headline || null);
      setRequest("");
      onChanged();
      toast(
        `Revised ${res.plan.modify.join(", ")}${res.plan.lock.length ? `, left ${res.plan.lock.join(", ")} alone` : ""}.`,
        "ok",
      );
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setRunning(null);
    }
  }

  const blocked = !aiAvailable
    ? "Add an OpenAI key in Settings to run the director."
    : analysedCount === 0
      ? "Analyse at least one clip first. The director reasons over shots, not video."
      : null;

  return (
    <Panel>
      <PanelHeader
        eyebrow="Creative director"
        title="Read the whole project, then propose"
        action={
          canRun ? (
            <Button
              size="sm"
              variant={projectWide.length || undecided ? "ghost" : "primary"}
              icon={<Sparkles size={14} />}
              loading={running === "direct"}
              disabled={Boolean(blocked) || running !== null}
              onClick={direct}
              title={blocked ?? undefined}
            >
              {recommendations.length ? "Run the director again" : "Run the director"}
            </Button>
          ) : null
        }
      />

      <div className="px-5 pb-5 space-y-4">
        <p className="text-[12.5px] text-mute leading-relaxed max-w-[66ch]">
          The director sees the brief, the template it came from, your rules, every measured
          shot, what was said, what you already decided, and a few stills. It answers with
          suggestions you approve, change or reject. It never touches the cut list on its own.
          {blocked ? <span className="block mt-1.5 text-warn">{blocked}</span> : null}
        </p>

        {memory && (memory.tendencies.length || memory.rejected.length || memory.house_rules.length || memory.template) ? (
          <details className="group">
            <summary className="text-[11.5px] text-faint cursor-pointer hover:text-mute list-none flex items-center gap-1.5">
              <Brain size={12} /> What the director remembers about you ({memory.sample_size} decisions counted)
            </summary>
            <ul className="mt-2 space-y-1 text-[12px] text-mute leading-relaxed">
              {memory.tendencies.map((t) => (
                <li key={t}>{t}</li>
              ))}
              {memory.rejected.length ? <li>Will not propose again: {memory.rejected.join("; ")}</li> : null}
              {memory.house_rules.length ? <li>House rules: {memory.house_rules.join("; ")}</li> : null}
              {memory.template ? (
                <li>
                  Favourite template: {memory.template.name} ({memory.template.uses} uses)
                </li>
              ) : null}
            </ul>
          </details>
        ) : null}

        {headline ? (
          <p className="text-[13px] text-chalk flex items-start gap-2">
            <Bot size={14} className="text-signal shrink-0 mt-0.5" />
            <span>{headline}</span>
          </p>
        ) : null}

        {canRun ? (
          <form onSubmit={revise} className="space-y-2">
            <label className="block">
              <span className="block text-[11px] text-faint mb-1.5">Ask AI to revise</span>
              <div className="flex gap-2">
                <input
                  className="field flex-1"
                  placeholder={EXAMPLES[0]}
                  value={request}
                  maxLength={1000}
                  disabled={Boolean(blocked) || running !== null}
                  onChange={(e) => setRequest(e.target.value)}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  icon={<Wand2 size={14} />}
                  loading={running === "revise"}
                  disabled={Boolean(blocked) || running !== null || request.trim().length < 3}
                >
                  Revise
                </Button>
              </div>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  className="text-[11px] text-faint hover:text-chalk-dim px-2 py-1 rounded-full border border-white/[0.07] transition-colors"
                  onClick={() => setRequest(example)}
                  disabled={running !== null}
                >
                  {example}
                </button>
              ))}
            </div>
            <p className="text-[11.5px] text-faint leading-relaxed">
              Say what may change and what must stay. Only the parts you name are opened up;
              anything you approved already is kept.
            </p>
          </form>
        ) : null}

        {lastPlan ? (
          <div className="glass-soft rounded-[12px] px-4 py-3 text-[12.5px] flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-chalk">Changed: {lastPlan.modify.join(", ")}</span>
            {lastPlan.lock.length ? (
              <span className="text-mute flex items-center gap-1.5">
                <Lock size={12} /> Left alone: {lastPlan.lock.join(", ")}
              </span>
            ) : null}
          </div>
        ) : null}

        {projectWide.length ? (
          <div className="space-y-2">
            <p className="text-[11px] text-faint uppercase tracking-wide">Project-wide suggestions</p>
            {projectWide.map((rec) => (
              <RecommendationRow
                key={rec.id}
                rec={rec}
                projectId={projectId}
                canDecide={canDecide}
                canExplain={canRun && aiAvailable}
                onChanged={onChanged}
              />
            ))}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
