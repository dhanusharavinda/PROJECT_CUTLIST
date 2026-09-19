"use client";

import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import { Check, ChevronRight, Sparkles } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { parseTimecode, timecode } from "@/lib/format";
import { labelStyle } from "@/lib/labelStyle";
import type { Recommendation, RecommendationStatus } from "@/lib/graph/recommendations";
import { api } from "@/components/project/useProject";

/**
 * One AI suggestion, and everything the creator can do about it.
 *
 * The row never writes to the cut list by itself. Approve, reject and
 * "needs review" are decisions on the suggestion; "Make it an instruction"
 * is the only path onto the cut list, and it is always a person pressing it.
 */

export const RECOMMENDATION_STATUS_META: Record<
  RecommendationStatus,
  { label: string; color: string }
> = {
  proposed: { label: "Proposed", color: "#b6bcc7" },
  approved: { label: "Approved", color: "#5fd3b0" },
  rejected: { label: "Rejected", color: "#737c8a" },
  modified: { label: "Changed by you", color: "#6bd5ff" },
  needs_review: { label: "Needs review", color: "#ffc857" },
  converted: { label: "Creator instruction", color: "#d6f55e" },
  superseded: { label: "Replaced", color: "#545c6a" },
};

/** Director-only types that have no cut list vocabulary of their own. */
const DIRECTOR_TYPE_LABEL: Record<string, string> = {
  hook: "Hook",
  order: "Order",
  remove: "Remove",
  pacing: "Pacing",
  narrative: "Narrative",
  inconsistency: "Inconsistency",
  missing: "Missing",
  conflict: "Conflict",
};

export function recommendationTypeLabel(type: string): string {
  return DIRECTOR_TYPE_LABEL[type] ?? labelStyle(type).label;
}

/** Where a suggestion came from, in the words the creator should read. */
export function sourceLabel(source: string): string {
  if (source.endsWith("+creator")) return "Changed by you";
  if (source.startsWith("local")) return "Measured";
  return "AI suggestion";
}

export function confidencePct(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value <= 1 ? value : value / 100)) * 100);
}

export function RecommendationRow({
  rec,
  projectId,
  canDecide,
  canExplain,
  picked,
  onTogglePick,
  onChanged,
}: {
  rec: Recommendation;
  projectId: string;
  /** Owners and creators decide. Everyone else reads. */
  canDecide: boolean;
  /** Whether "Explain" should be offered at all (viewers cannot ask). */
  canExplain: boolean;
  picked?: boolean;
  onTogglePick?: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const style = labelStyle(rec.type);
  const status = RECOMMENDATION_STATUS_META[rec.status] ?? RECOMMENDATION_STATUS_META.proposed;

  const [busy, setBusy] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [explanation, setExplanation] = useState<{ text: string; model: string } | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);

  const rationale = rec.rationale.trim();
  const detail = rec.detail.trim();
  const whyText = rationale || detail;
  const showDetail = detail && detail !== rec.title && detail !== whyText;
  const decided = rec.status === "converted" || rec.status === "superseded";
  const source = sourceLabel(rec.source);
  const pct = confidencePct(rec.confidence);

  async function setStatus(next: RecommendationStatus, note?: string) {
    setBusy(next);
    try {
      await api(`/api/recommendations/${rec.id}`, {
        method: "PATCH",
        json: note ? { status: next, reason: note } : { status: next },
      });
      setRejecting(false);
      setReason("");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function convert() {
    setBusy("convert");
    try {
      await api(`/api/recommendations/${rec.id}/convert`, { method: "POST" });
      toast("Now a creator instruction on the cut list", "ok");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function explain() {
    setBusy("explain");
    setExplainError(null);
    try {
      const res = await api<{ explanation: string; model: string }>(
        `/api/recommendations/${rec.id}/explain`,
        { method: "POST" },
      );
      setExplanation({ text: res.explanation, model: res.model });
      setWhy(true);
    } catch (err) {
      // A missing key comes back as a readable 400; show it where the
      // person is looking rather than only in a toast.
      setExplainError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const actions: { key: string; label: string; onClick: () => void; primary?: boolean }[] = [];
  if (canDecide && !decided) {
    const approve = { key: "approved", label: "Approve", onClick: () => setStatus("approved") };
    const reject = { key: "reject", label: "Reject", onClick: () => setRejecting((v) => !v) };
    const review = {
      key: "needs_review",
      label: "Needs review",
      onClick: () => setStatus("needs_review"),
    };
    const modify = { key: "modify", label: "Modify", onClick: () => setEditing((v) => !v) };
    const instruct = (primary: boolean) => ({
      key: "convert",
      label: "Make it an instruction",
      onClick: convert,
      primary,
    });

    if (rec.status === "proposed") actions.push(approve, reject, review, modify, instruct(false));
    else if (rec.status === "needs_review") actions.push(approve, reject, modify, instruct(false));
    else if (rec.status === "approved") actions.push(instruct(true), reject, modify);
    else if (rec.status === "modified") actions.push(approve, reject, modify, instruct(false));
    else if (rec.status === "rejected")
      actions.push({ key: "proposed", label: "Restore", onClick: () => setStatus("proposed") });
  }
  if (canExplain && !decided) {
    actions.push({ key: "explain", label: explanation ? "Explain again" : "Explain", onClick: explain });
  }

  const primary = actions.find((a) => a.primary);
  const rest = actions.filter((a) => !a.primary);

  return (
    <li
      className={clsx(
        "rounded-[11px] border px-3 py-2.5 transition-colors",
        picked
          ? "border-signal/40 bg-signal/[0.05]"
          : rec.status === "rejected"
            ? "border-white/[0.04] bg-white/[0.012]"
            : "border-white/[0.07] bg-white/[0.02]",
      )}
      style={
        rec.priority === "high" && rec.status !== "rejected"
          ? { boxShadow: `inset 2px 0 0 ${style.color}` }
          : undefined
      }
    >
      <div className="flex items-start gap-2.5">
        {onTogglePick ? (
          <button
            onClick={onTogglePick}
            aria-pressed={picked}
            aria-label={picked ? `Remove ${rec.title}` : `Select ${rec.title}`}
            className={clsx(
              "mt-0.5 size-[18px] shrink-0 grid place-items-center rounded-[6px] border transition-colors",
              picked
                ? "bg-signal border-signal text-ink-950"
                : "border-white/20 text-transparent hover:border-signal/60",
            )}
          >
            <Check size={11} strokeWidth={3} />
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          {/* Where, what kind, and what state it is in */}
          <div className="flex items-center gap-2 flex-wrap">
            {rec.video_id && rec.start_ms !== null ? (
              <Link
                href={`/app/projects/${projectId}/walkthrough/${rec.video_id}?t=${rec.start_ms}`}
                className="tabular text-[11px] text-mute hover:text-signal transition-colors"
              >
                {timecode(rec.start_ms)}
                {rec.end_ms ? `-${timecode(rec.end_ms)}` : ""}
              </Link>
            ) : (
              <span className="text-[11px] text-faint">whole reel</span>
            )}
            <span
              className="text-[10px] uppercase tracking-wider font-medium"
              style={{ color: style.color }}
            >
              {recommendationTypeLabel(rec.type)}
            </span>
            {rec.priority === "high" && rec.status !== "rejected" ? (
              <span className="text-[10px] text-danger">high</span>
            ) : null}
            <span
              className="inline-flex items-center rounded-full border px-2 py-px text-[10px] font-medium"
              style={{
                color: status.color,
                background: `${status.color}14`,
                borderColor: `${status.color}33`,
              }}
            >
              {status.label}
            </span>
            {rec.supersedes_id ? (
              <span className="text-[10px] text-faint">replaces an earlier suggestion</span>
            ) : null}
          </div>

          <p
            className={clsx(
              "text-[13px] mt-1 leading-snug",
              rec.status === "rejected" ? "text-faint line-through" : "text-chalk",
            )}
          >
            {rec.title}
          </p>
          {showDetail ? (
            <p className="text-[12px] text-mute mt-1 leading-relaxed">{detail}</p>
          ) : null}

          {/* Source and confidence: never hidden, always quiet */}
          <div className="flex items-center gap-2 flex-wrap mt-1.5 text-[10.5px] text-faint">
            <span className="inline-flex items-center gap-1">
              {source === "AI suggestion" ? <Sparkles size={9} /> : null}
              {source}
            </span>
            <span className="size-[3px] rounded-full bg-faint/50" />
            <span className="tabular" title="How sure the source was">
              {pct}% sure
            </span>
            {whyText ? (
              <>
                <span className="size-[3px] rounded-full bg-faint/50" />
                <button
                  onClick={() => setWhy((v) => !v)}
                  aria-expanded={why}
                  className="inline-flex items-center gap-0.5 hover:text-chalk transition-colors"
                >
                  Why
                  <ChevronRight
                    size={10}
                    className={clsx("transition-transform", why && "rotate-90")}
                  />
                </button>
              </>
            ) : null}
          </div>

          {why && whyText ? (
            <p className="mt-1.5 text-[12px] text-mute leading-relaxed border-l border-white/10 pl-2.5">
              {whyText}
            </p>
          ) : null}

          {explanation ? (
            <div className="mt-2 rounded-[9px] bg-white/[0.03] border border-white/[0.06] px-2.5 py-2">
              <p className="text-[10.5px] text-faint mb-1 inline-flex items-center gap-1">
                <Sparkles size={9} /> AI explanation
                <span className="tabular opacity-70">{explanation.model}</span>
              </p>
              <p className="text-[12px] text-chalk-dim leading-relaxed whitespace-pre-wrap">
                {explanation.text}
              </p>
            </div>
          ) : null}

          {explainError ? (
            <p className="mt-2 text-[12px] text-warn leading-relaxed">{explainError}</p>
          ) : null}

          {rejecting ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setStatus("rejected", reason.trim() || undefined);
                  if (e.key === "Escape") setRejecting(false);
                }}
                placeholder="Why not? (optional)"
                className="field flex-1 min-w-[160px] !py-1.5 text-[12px]"
                aria-label="Reason for rejecting"
              />
              <Button
                size="sm"
                variant="danger"
                loading={busy === "rejected"}
                onClick={() => setStatus("rejected", reason.trim() || undefined)}
              >
                Reject
              </Button>
              <button
                onClick={() => setRejecting(false)}
                className="text-[11px] text-faint hover:text-chalk"
              >
                Cancel
              </button>
            </div>
          ) : null}

          {editing ? (
            <ModifyForm
              rec={rec}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                onChanged();
              }}
            />
          ) : null}

          {actions.length ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {primary ? (
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy === primary.key}
                  onClick={primary.onClick}
                >
                  {primary.label}
                </Button>
              ) : null}
              {rest.map((action) => (
                <button
                  key={action.key}
                  onClick={action.onClick}
                  disabled={busy !== null}
                  className={clsx(
                    "text-[11.5px] transition-colors disabled:opacity-50",
                    action.key === "convert"
                      ? "text-signal/80 hover:text-signal"
                      : action.key === "approved"
                        ? "text-ok/80 hover:text-ok"
                        : "text-mute hover:text-chalk",
                  )}
                >
                  {busy === action.key ? "Working..." : action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * Inline change to a suggestion. Saving does not edit the row in place: the
 * server creates a new recommendation that supersedes this one, so the record
 * of what the AI originally said survives.
 */
function ModifyForm({
  rec,
  onCancel,
  onSaved,
}: {
  rec: Recommendation;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: rec.title,
    detail: rec.detail || rec.rationale,
    priority: rec.priority,
    at: rec.start_ms === null ? "" : timecode(rec.start_ms),
    to: rec.end_ms === null ? "" : timecode(rec.end_ms),
  });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const startMs = form.at.trim() ? parseTimecode(form.at) : null;
    const endMs = form.to.trim() ? parseTimecode(form.to) : null;
    if (form.at.trim() && startMs === null)
      return toast("That start time doesn't parse. Try 1:23.", "error");
    if (form.to.trim() && endMs === null)
      return toast("That end time doesn't parse. Try 1:23.", "error");
    if (!form.title.trim()) return toast("Give it a title.", "error");

    const changes: Record<string, unknown> = {};
    if (form.title.trim() !== rec.title) changes.title = form.title.trim();
    if (form.detail.trim() !== rec.detail) changes.detail = form.detail.trim();
    if (form.priority !== rec.priority) changes.priority = form.priority;
    if (startMs !== rec.start_ms) changes.startMs = startMs;
    if (endMs !== rec.end_ms) changes.endMs = endMs;
    if (Object.keys(changes).length === 0) return onCancel();

    setBusy(true);
    try {
      await api(`/api/recommendations/${rec.id}`, { method: "PATCH", json: changes });
      toast("Saved as your version of the suggestion", "ok");
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="mt-2 rounded-[9px] bg-white/[0.03] border border-white/[0.06] p-2.5 space-y-2"
    >
      <input
        autoFocus
        className="field !py-1.5 text-[12.5px]"
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        aria-label="Title"
        placeholder="What to do"
      />
      <textarea
        rows={2}
        className="field !py-1.5 text-[12px] leading-relaxed resize-y"
        value={form.detail}
        onChange={(e) => setForm({ ...form, detail: e.target.value })}
        aria-label="Detail"
        placeholder="Anything the editor needs beyond the one-liner"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="field tabular !py-1.5 text-[12px] w-[84px]"
          value={form.at}
          onChange={(e) => setForm({ ...form, at: e.target.value })}
          aria-label="Start time"
          placeholder="0:00"
        />
        <span className="text-[11px] text-faint">to</span>
        <input
          className="field tabular !py-1.5 text-[12px] w-[84px]"
          value={form.to}
          onChange={(e) => setForm({ ...form, to: e.target.value })}
          aria-label="End time"
          placeholder="end"
        />
        <select
          className="field !py-1.5 text-[12px] w-auto cursor-pointer"
          value={form.priority}
          onChange={(e) =>
            setForm({ ...form, priority: e.target.value as Recommendation["priority"] })
          }
          aria-label="Priority"
        >
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
        <span className="flex-1" />
        <button type="button" onClick={onCancel} className="text-[11px] text-faint hover:text-chalk">
          Cancel
        </button>
        <Button type="submit" size="sm" variant="primary" loading={busy}>
          Save my version
        </Button>
      </div>
      <p className="text-[10.5px] text-faint leading-relaxed">
        Saving keeps the AI's original and adds your version above it, marked "Changed by you".
      </p>
    </form>
  );
}
