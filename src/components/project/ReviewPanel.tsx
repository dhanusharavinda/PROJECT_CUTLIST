"use client";

import { useState } from "react";
import {
  AlertTriangle,
  HelpCircle,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button, Chip, Empty, useToast } from "@/components/ui";
import { labelStyle } from "@/lib/labelStyle";
import { relativeTime, timecode } from "@/lib/format";
import type { SuggestionPayload } from "@/lib/types";
import { api } from "./useProject";

export function ReviewPanel({
  projectId,
  suggestion,
  canRun,
  hasLlm,
  activeVideoId,
  onChanged,
}: {
  projectId: string;
  suggestion: { payload: string; model: string; created_at: number } | null;
  canRun: boolean;
  hasLlm: boolean;
  activeVideoId?: string | null;
  onChanged: () => void;
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
