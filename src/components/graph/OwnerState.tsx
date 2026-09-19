"use client";

import { useState } from "react";
import { Bot, UserRound } from "lucide-react";
import { Spinner, useToast } from "@/components/ui";
import { OWNER_STATES, type OwnerState as OwnerStateValue } from "@/lib/types";
import { api } from "@/components/project/useProject";

/**
 * Who holds the edit right now.
 *
 * The edit moves between the creator, an AI agent and a human editor. Whoever
 * holds it is the only one expected to be changing it, so the project says so
 * in plain words at the top of the page, and the creator hands it on from here.
 */

export const OWNER_STATE_META: Record<
  OwnerStateValue,
  { label: string; hint: string; color: string; holder: "creator" | "ai" | "human" }
> = {
  awaiting_creator: {
    label: "Awaiting creator",
    hint: "The edit is with you. Decide on the AI's suggestions, add instructions, then hand it on.",
    color: "#d6f55e",
    holder: "creator",
  },
  ready_for_ai: {
    label: "Ready for AI",
    hint: "Your instructions are set. An AI agent can pick the edit up and return a draft.",
    color: "#8aa2ff",
    holder: "ai",
  },
  ai_executing: {
    label: "AI executing",
    hint: "An AI agent holds the edit. It comes back as a version in History when it is done.",
    color: "#8aa2ff",
    holder: "ai",
  },
  ready_for_human: {
    label: "Ready for human editor",
    hint: "The packet is ready for a human editor to pick up. Nothing more is expected from you yet.",
    color: "#6bd5ff",
    holder: "human",
  },
  human_editing: {
    label: "Human editor editing",
    hint: "A human editor holds the edit. New instructions wait for their next pass.",
    color: "#6bd5ff",
    holder: "human",
  },
  ready_for_review: {
    label: "Ready for review",
    hint: "A version came back. Look at it in History, then approve it or ask for changes.",
    color: "#c77dff",
    holder: "creator",
  },
};

export function OwnerState({
  projectId,
  value,
  canChange,
  onChanged,
  className,
}: {
  projectId: string;
  value: OwnerStateValue;
  canChange: boolean;
  onChanged: () => void;
  className?: string;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const meta = OWNER_STATE_META[value] ?? OWNER_STATE_META.awaiting_creator;

  async function handOn(next: OwnerStateValue) {
    if (next === value) return;
    setSaving(true);
    try {
      await api(`/api/projects/${projectId}`, {
        method: "PATCH",
        json: { ownerState: next },
      });
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-faint">Who holds the edit</span>
        <span className="relative inline-flex items-center">
          <span
            aria-hidden
            className="pointer-events-none absolute left-2.5 grid place-items-center"
            style={{ color: meta.color }}
          >
            {meta.holder === "ai" ? <Bot size={12} /> : <UserRound size={12} />}
          </span>
          <select
            value={value}
            onChange={(e) => handOn(e.target.value as OwnerStateValue)}
            disabled={!canChange || saving}
            aria-label="Who holds the edit"
            className="appearance-none cursor-pointer rounded-full border pl-7 pr-3 py-[3px] text-[11.5px] font-medium bg-transparent disabled:cursor-default"
            style={{
              color: meta.color,
              background: `${meta.color}14`,
              borderColor: `${meta.color}33`,
            }}
          >
            {OWNER_STATES.map((state) => (
              <option key={state} value={state}>
                {OWNER_STATE_META[state].label}
              </option>
            ))}
          </select>
        </span>
        {saving ? <Spinner className="text-faint" /> : null}
      </div>
      <p className="text-[11.5px] text-mute mt-1.5 leading-relaxed max-w-[64ch]">{meta.hint}</p>
    </div>
  );
}
