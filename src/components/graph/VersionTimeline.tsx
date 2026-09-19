"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { Bot, Check, History, Package, Plus, UserRound } from "lucide-react";
import { Button, Empty, Labeled, Modal, Panel, PanelHeader, useToast } from "@/components/ui";
import { relativeTime, timecode } from "@/lib/format";
import type { Recommendation } from "@/lib/graph/recommendations";
import type { Approval, ProjectVersionView, VersionKind } from "@/lib/graph/versions";
import type { Label, Video } from "@/lib/types";
import { api } from "@/components/project/useProject";

/**
 * V1 AI draft, V2 Human edit, V3 Creator revision: the project's history as a
 * vertical timeline, with the creator's verdict on each version.
 *
 * A version is a named moment, not a copy of the media. What this shows is
 * who made it, what they said about it, and what changed.
 */

const KIND_OPTIONS: { value: VersionKind; label: string; hint: string }[] = [
  { value: "ai_draft", label: "AI draft", hint: "An AI agent produced a first cut." },
  { value: "human_edit", label: "Human edit", hint: "A human editor returned a cut." },
  { value: "creator_revision", label: "Creator revision", hint: "You asked for changes." },
  { value: "ai_revision", label: "AI revision", hint: "An AI agent returned a revised cut." },
  { value: "human_final", label: "Human final", hint: "The human editor's final delivery." },
];

const ACTOR_LABEL: Record<string, string> = {
  ai: "AI edit",
  editor: "Human edit",
  creator: "Creator",
  system: "System",
};

const APPROVAL_META: Record<Approval, { label: string; color: string }> = {
  pending: { label: "Awaiting your verdict", color: "#ffc857" },
  approved: { label: "Approved", color: "#5fd3b0" },
  changes_requested: { label: "Changes requested", color: "#ff6b57" },
};

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function VersionTimeline({
  projectId,
  versions,
  recommendations,
  labels,
  videos,
  canApprove,
  canRecord,
  onChanged,
}: {
  projectId: string;
  versions: ProjectVersionView[];
  /** Live recommendations only: what is still on the table. */
  recommendations: Recommendation[];
  labels: Label[];
  videos: Video[];
  /** Owners and creators approve. */
  canApprove: boolean;
  /** Anyone who can label can record a version. */
  canRecord: boolean;
  onChanged: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const clipTitle = useMemo(() => new Map(videos.map((v) => [v.id, v.title])), [videos]);

  // Three short answers, computed rather than typed: what the AI did, what
  // the human did, what the creator asked for.
  const summary = useMemo(() => {
    const ordered = [...versions].sort((a, b) => a.number - b.number);
    const lastAi = [...ordered].reverse().find((v) => v.actor_kind === "ai");
    const lastHuman = [...ordered].reverse().find((v) => v.actor_kind === "editor");
    const lastCreator = [...ordered].reverse().find((v) => v.kind === "creator_revision");

    const proposed = recommendations.filter(
      (r) => r.status === "proposed" || r.status === "modified",
    ).length;
    const needsReview = recommendations.filter((r) => r.status === "needs_review").length;
    const approved = recommendations.filter((r) => r.status === "approved").length;
    const rejected = recommendations.filter((r) => r.status === "rejected").length;
    const converted = labels.filter((l) => l.source === "recommendation").length;
    const open = labels.filter((l) => l.status === "open" || l.status === "doing").length;
    const done = labels.filter((l) => l.status === "done").length;

    const ai = lastAi
      ? `${lastAi.label}${lastAi.summary ? `: ${lastAi.summary}` : ""}. ${plural(proposed, "suggestion")} still waiting on you${needsReview ? `, ${needsReview} marked needs review` : ""}.`
      : proposed || needsReview
        ? `No AI draft recorded yet. ${plural(proposed + needsReview, "suggestion")} on the Plan tab waiting for your decision.`
        : "Nothing yet. Generate a plan on the Plan tab, or record an AI draft when one comes back.";

    const human = lastHuman
      ? `${lastHuman.label}${lastHuman.actor_name ? ` by ${lastHuman.actor_name}` : ""}${lastHuman.summary ? `: ${lastHuman.summary}` : ""}. ${plural(lastHuman.payload.completed?.length ?? done, "instruction")} done, ${plural(lastHuman.payload.unresolved?.length ?? open, "instruction")} still open.`
      : "No human edit has come back yet.";

    const creator = `${plural(open, "open instruction")} on the cut list, ${converted} of them from accepted suggestions. ${approved} approved and not yet made an instruction, ${rejected} rejected.${lastCreator ? ` Latest ask: ${lastCreator.label}${lastCreator.summary ? `, ${lastCreator.summary}` : ""}.` : ""}`;

    return { ai, human, creator };
  }, [versions, recommendations, labels]);

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          eyebrow="Where things stand"
          title="Who did what"
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <a href={`/api/projects/${projectId}/export?format=package`}>
                <Button size="sm" icon={<Package size={13} />}>
                  Export AI project package
                </Button>
              </a>
              {canRecord ? (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Plus size={13} />}
                  onClick={() => setRecording(true)}
                >
                  Record a version
                </Button>
              ) : null}
            </div>
          }
        />
        <dl className="px-5 pb-5 space-y-2.5">
          {(
            [
              ["What the AI did", summary.ai, <Bot key="ai" size={12} />],
              ["What the human did", summary.human, <UserRound key="human" size={12} />],
              ["What the creator asked for", summary.creator, <Check key="creator" size={12} />],
            ] as const
          ).map(([label, text, icon]) => (
            <div key={label} className="flex items-start gap-3">
              <dt className="shrink-0 w-[150px] sm:w-[190px] text-[11px] text-faint inline-flex items-center gap-1.5 pt-px">
                {icon}
                {label}
              </dt>
              <dd className="text-[12.5px] text-chalk-dim leading-relaxed min-w-0">{text}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      {versions.length === 0 ? (
        <Panel>
          <Empty
            icon={<History size={17} />}
            title="No versions yet"
            hint="Record one when a cut comes back: an AI draft, a human edit, or your own revision. Each one keeps a snapshot of the reel at that moment."
            action={
              canRecord ? (
                <Button size="sm" icon={<Plus size={13} />} onClick={() => setRecording(true)}>
                  Record a version
                </Button>
              ) : null
            }
          />
        </Panel>
      ) : (
        <Panel>
          <div className="px-5 pt-4 pb-2">
            <span className="text-eyebrow">History</span>
          </div>
          <ol className="px-5 pb-5">
            {[...versions]
              .sort((a, b) => b.number - a.number)
              .map((version, index, all) => (
                <VersionEntry
                  key={version.id}
                  version={version}
                  last={index === all.length - 1}
                  clipTitle={version.video_id ? clipTitle.get(version.video_id) ?? null : null}
                  projectId={projectId}
                  canApprove={canApprove}
                  onChanged={onChanged}
                />
              ))}
          </ol>
        </Panel>
      )}

      <RecordModal
        projectId={projectId}
        videos={videos}
        open={recording}
        onClose={() => setRecording(false)}
        onSaved={onChanged}
      />
    </div>
  );
}

function VersionEntry({
  version,
  last,
  clipTitle,
  projectId,
  canApprove,
  onChanged,
}: {
  version: ProjectVersionView;
  last: boolean;
  clipTitle: string | null;
  projectId: string;
  canApprove: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<Approval | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const approval = APPROVAL_META[version.approval] ?? APPROVAL_META.pending;
  const isAi = version.actor_kind === "ai";
  const actorLabel = ACTOR_LABEL[version.actor_kind] ?? version.actor_kind;
  const changes = version.payload.changes ?? [];

  async function decide(next: Approval) {
    setBusy(next);
    try {
      await api(`/api/versions/${version.id}`, {
        method: "PATCH",
        json: next === "changes_requested" && note.trim() ? { approval: next, note: note.trim() } : { approval: next },
      });
      setAsking(false);
      setNote("");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="relative flex gap-4">
      {/* The rail */}
      <div className="flex flex-col items-center shrink-0 w-6">
        <span
          className="mt-1 size-6 grid place-items-center rounded-full border"
          style={{
            color: isAi ? "#8aa2ff" : "#6bd5ff",
            background: isAi ? "#8aa2ff14" : "#6bd5ff14",
            borderColor: isAi ? "#8aa2ff40" : "#6bd5ff40",
          }}
          aria-hidden
        >
          {isAi ? <Bot size={12} /> : <UserRound size={12} />}
        </span>
        {last ? null : <span className="flex-1 w-px bg-white/[0.08] my-1.5" />}
      </div>

      <div className={clsx("min-w-0 flex-1", last ? "pb-1" : "pb-6")}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13.5px] text-chalk font-medium">{version.label}</span>
          <span className="text-[10px] uppercase tracking-wider text-faint">{actorLabel}</span>
          <span className="text-[11px] text-faint">
            {version.actor_name ? `${version.actor_name} · ` : ""}
            {relativeTime(version.created_at)}
          </span>
          <span
            className="inline-flex items-center rounded-full border px-2 py-px text-[10px] font-medium"
            style={{
              color: approval.color,
              background: `${approval.color}14`,
              borderColor: `${approval.color}33`,
            }}
          >
            {approval.label}
          </span>
        </div>

        {version.title && version.title !== version.label.replace(/^V\d+\s/, "") ? (
          <p className="text-[13px] text-chalk-dim mt-1 leading-snug">{version.title}</p>
        ) : null}
        {version.summary ? (
          <p className="text-[12.5px] text-mute mt-1 leading-relaxed">{version.summary}</p>
        ) : null}

        {changes.length ? (
          <ul className="mt-2 space-y-1">
            {changes.map((change, index) => (
              <li key={index} className="text-[12px] text-chalk-dim leading-relaxed flex gap-2">
                <span className="mt-[7px] size-1 rounded-full bg-signal/70 shrink-0" />
                {change}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10.5px] text-faint tabular">
          {version.payload.total_ms !== undefined ? (
            <span>reel {timecode(version.payload.total_ms)}</span>
          ) : null}
          {version.payload.slots ? <span>{plural(version.payload.slots.length, "slot")}</span> : null}
          {version.payload.open_instructions !== undefined ? (
            <span>{plural(version.payload.open_instructions, "open instruction")}</span>
          ) : null}
          {version.payload.proposed_recommendations !== undefined ? (
            <span>{plural(version.payload.proposed_recommendations, "AI suggestion")} pending</span>
          ) : null}
          {version.video_id ? (
            <Link
              href={`/app/projects/${projectId}/walkthrough/${version.video_id}`}
              className="text-mute hover:text-signal transition-colors"
            >
              Returned cut: {clipTitle ?? "open clip"}
            </Link>
          ) : null}
        </div>

        {canApprove ? (
          <div className="mt-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {version.approval !== "approved" ? (
                <Button
                  size="sm"
                  variant={version.approval === "pending" ? "primary" : "ghost"}
                  icon={<Check size={13} />}
                  loading={busy === "approved"}
                  onClick={() => decide("approved")}
                >
                  Approve
                </Button>
              ) : null}
              {version.approval !== "changes_requested" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === "changes_requested"}
                  onClick={() => setAsking((v) => !v)}
                >
                  Request changes
                </Button>
              ) : null}
              {version.approval !== "pending" ? (
                <button
                  onClick={() => decide("pending")}
                  disabled={busy !== null}
                  className="text-[11px] text-faint hover:text-chalk"
                >
                  Reopen
                </button>
              ) : null}
            </div>
            {asking ? (
              <div className="mt-2 flex flex-wrap items-start gap-2">
                <textarea
                  autoFocus
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setAsking(false);
                  }}
                  placeholder="What needs to change? Goes into the record with your request."
                  className="field flex-1 min-w-[200px] resize-none text-[12px] leading-relaxed"
                  aria-label="What needs to change"
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busy === "changes_requested"}
                    onClick={() => decide("changes_requested")}
                  >
                    Send
                  </Button>
                  <button
                    onClick={() => setAsking(false)}
                    className="text-[11px] text-faint hover:text-chalk"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function RecordModal({
  projectId,
  videos,
  open,
  onClose,
  onSaved,
}: {
  projectId: string;
  videos: Video[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    kind: "human_edit" as VersionKind,
    summary: "",
    changes: "",
    videoId: "",
  });

  const kind = KIND_OPTIONS.find((k) => k.value === form.kind) ?? KIND_OPTIONS[1];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const changes = form.changes
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      await api(`/api/projects/${projectId}/versions`, {
        method: "POST",
        json: {
          kind: form.kind,
          summary: form.summary.trim() || undefined,
          changes: changes.length ? changes : undefined,
          videoId: form.videoId || undefined,
        },
      });
      toast("Version recorded", "ok");
      setForm({ kind: "human_edit", summary: "", changes: "", videoId: "" });
      onClose();
      onSaved();
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
      title="Record a version"
      description="A named moment in the project. The reel and the counts are snapshotted with it."
      width={470}
    >
      <form onSubmit={submit} className="space-y-4">
        <Labeled label="What came back" hint={kind.hint}>
          <select
            className="field cursor-pointer"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as VersionKind })}
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Labeled>

        <Labeled label="Summary">
          <textarea
            autoFocus
            rows={3}
            className="field resize-y leading-relaxed"
            placeholder="One or two lines on what this version is."
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
          />
        </Labeled>

        <Labeled label="What changed" hint="One change per line. Optional.">
          <textarea
            rows={3}
            className="field resize-y leading-relaxed"
            placeholder={"Tightened the hook to 1.2s\nSwapped the music drop to 0:14"}
            value={form.changes}
            onChange={(e) => setForm({ ...form, changes: e.target.value })}
          />
        </Labeled>

        {videos.length ? (
          <Labeled label="Returned cut" hint="If the cut was added to this project as a clip, link it here.">
            <select
              className="field cursor-pointer"
              value={form.videoId}
              onChange={(e) => setForm({ ...form, videoId: e.target.value })}
            >
              <option value="">No clip linked</option>
              {videos.map((video) => (
                <option key={video.id} value={video.id}>
                  {video.title}
                </option>
              ))}
            </select>
          </Labeled>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Record version
          </Button>
        </div>
      </form>
    </Modal>
  );
}
