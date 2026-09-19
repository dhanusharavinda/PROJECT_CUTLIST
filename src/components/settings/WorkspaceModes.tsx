"use client";

import { useState } from "react";
import clsx from "clsx";
import { CheckCircle2, CircleSlash, User } from "lucide-react";
import { Panel, PanelHeader, useToast } from "@/components/ui";
import { api } from "@/components/project/useProject";

/**
 * Two workspace-level switches that do not belong with the AI keys: whether
 * this is a one-person workspace, and whether footage analysis has a working
 * ffmpeg behind it.
 */
export function WorkspaceModes({
  solo: initialSolo,
  ffmpeg,
  canManage,
}: {
  solo: boolean;
  ffmpeg: { ok: boolean; hint: string };
  canManage: boolean;
}) {
  const toast = useToast();
  const [solo, setSolo] = useState(initialSolo);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await api("/api/settings", {
        method: "PUT",
        json: { settings: { SOLO_MODE: next ? "on" : "off" } },
      });
      setSolo(next);
      toast(
        next
          ? "Solo mode on. The chat room and presence are hidden."
          : "Solo mode off. The room is back.",
        "ok",
      );
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="mt-4">
      <PanelHeader eyebrow="Workspace" title="How you work" />

      <div className="px-5 pb-5 space-y-3">
        <div className="flex items-start gap-3 rounded-[12px] glass-soft px-4 py-3.5">
          <User size={15} className="text-faint shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-chalk">Solo mode</p>
            <p className="text-[12px] text-mute mt-1 leading-relaxed">
              You edit your own videos, so there is nobody to hand off to. This hides the
              chat room and the presence avatars and leaves the brief, the footage
              analysis and the cut list.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={solo}
            aria-label="Solo mode"
            disabled={!canManage || busy}
            onClick={() => toggle(!solo)}
            className={clsx(
              "shrink-0 h-6 w-11 rounded-full transition-colors relative disabled:opacity-40",
              solo ? "bg-signal" : "bg-white/12",
            )}
          >
            <span
              className={clsx(
                "absolute top-0.5 size-5 rounded-full bg-ink-950 transition-all",
                solo ? "left-[22px]" : "left-0.5",
              )}
            />
          </button>
        </div>

        <div className="flex items-start gap-3 rounded-[12px] glass-soft px-4 py-3.5">
          {ffmpeg.ok ? (
            <CheckCircle2 size={15} className="text-ok shrink-0 mt-0.5" />
          ) : (
            <CircleSlash size={15} className="text-warn shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <p className="text-[13px] text-chalk">Footage analysis</p>
            <p className="text-[12px] text-mute mt-1 leading-relaxed">{ffmpeg.hint}</p>
          </div>
        </div>
      </div>
    </Panel>
  );
}
