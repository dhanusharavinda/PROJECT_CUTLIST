"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, Check, Lock } from "lucide-react";
import { Button, Labeled, Meter, Modal, Spinner, useToast } from "@/components/ui";
import {
  BRIEF_SECTIONS,
  completeness,
  missingRequired,
  type BriefValues,
} from "@/lib/brief";
import type { ProjectDetail } from "@/lib/queries";
import type { TemplateView } from "@/lib/templates/store";
import { TemplatePicker } from "@/components/templates/TemplatePicker";
import { BriefFields } from "./BriefFields";
import { api } from "./useProject";

export function BriefForm({
  projectId,
  initial,
  canEdit,
  template = null,
  projectName,
}: {
  projectId: string;
  initial: BriefValues;
  canEdit: boolean;
  /** The template this project was started from, if any. */
  template?: { name: string; version: number } | null;
  /** Used only to suggest a name when saving the brief as a template. */
  projectName?: string;
}) {
  const toast = useToast();
  const [values, setValues] = useState<BriefValues>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(values);

  const [saveOpen, setSaveOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  // The brief is long. Autosave means nobody loses a paragraph to a stray click.
  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api(`/api/projects/${projectId}/brief`, {
        method: "PUT",
        json: { values: latest.current },
      });
      setSavedAt(Date.now());
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }, [projectId, toast]);

  const update = useCallback(
    (key: string, value: string | string[]) => {
      setValues((current) => {
        const next = { ...current, [key]: value };
        latest.current = next;
        return next;
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, 900);
    },
    [save],
  );

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function applyTemplate(picked: TemplateView | null) {
    if (!picked) return;
    setApplying(true);
    try {
      const result = await api<{ applied: number; version: number; detail: ProjectDetail }>(
        `/api/projects/${projectId}/template`,
        { method: "POST", json: { templateId: picked.id, mode: "fill" } },
      );
      // A pending autosave would post the values from before the template.
      if (timer.current) clearTimeout(timer.current);
      const next = result.detail.brief.payload;
      latest.current = next;
      setValues(next);
      setSavedAt(Date.now());
      toast(
        result.applied === 0
          ? `Nothing to fill: every field ${picked.name} sets was already written.`
          : `Filled ${result.applied} field${result.applied === 1 ? "" : "s"} from ${picked.name} v${result.version}.`,
        "ok",
      );
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setApplying(false);
    }
  }

  const score = useMemo(() => completeness(values), [values]);
  const missing = useMemo(() => missingRequired(values), [values]);

  return (
    <div>
      <div className="glass rounded-[15px] p-4 mb-5">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div>
            <p className="text-[13px] font-medium text-chalk">
              {score === 100
                ? "Brief complete"
                : score > 60
                  ? "Nearly there"
                  : "The brief drives everything else"}
            </p>
            <p className="text-[11.5px] text-mute mt-0.5">
              {missing.length === 0
                ? "The editor has what they need to start."
                : `${missing.length} required field${missing.length === 1 ? "" : "s"} left: ${missing
                    .slice(0, 3)
                    .map((f) => f.label.toLowerCase())
                    .join(", ")}${missing.length > 3 ? "…" : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saving ? (
              <span className="text-[11px] text-faint flex items-center gap-1.5">
                <Spinner /> saving
              </span>
            ) : savedAt ? (
              <span className="text-[11px] text-ok flex items-center gap-1">
                <Check size={12} /> saved
              </span>
            ) : null}
            <span className="text-display text-[26px] leading-none text-signal">
              {score}
              <span className="text-[14px] text-mute">%</span>
            </span>
          </div>
        </div>
        <Meter value={score} />
      </div>

      {!canEdit ? (
        <p className="mb-5 flex items-center gap-2 text-[12.5px] text-mute glass-soft rounded-[11px] px-3.5 py-2.5">
          <Lock size={13} className="shrink-0 text-faint" />
          Only the creator and workspace owner can edit the brief. This is what
          they decided.
        </p>
      ) : null}

      {canEdit || template ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
          <p className="text-[12px] text-mute flex items-center gap-1.5 min-w-0">
            <BookMarked size={13} className="text-faint shrink-0" aria-hidden />
            {template ? (
              <span className="truncate">
                Started from <span className="text-chalk-dim">{template.name}</span> v
                {template.version}
              </span>
            ) : (
              <span>Templates</span>
            )}
          </p>
          {canEdit ? (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="quiet" onClick={() => setSaveOpen(true)}>
                Save as template
              </Button>
              <Button
                size="sm"
                variant="quiet"
                loading={applying}
                onClick={() => setPickOpen(true)}
              >
                Apply a template
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <BriefFields
        sections={BRIEF_SECTIONS}
        values={values}
        onChange={update}
        disabled={!canEdit}
      />

      <SaveAsTemplateModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        projectId={projectId}
        suggestedName={
          (typeof values.category === "string" && values.category) || projectName || ""
        }
      />

      <TemplatePicker open={pickOpen} onClose={() => setPickOpen(false)} onPick={applyTemplate} />
    </div>
  );
}

function SaveAsTemplateModal({
  open,
  onClose,
  projectId,
  suggestedName,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  suggestedName: string;
}) {
  const toast = useToast();
  const [name, setName] = useState(suggestedName);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<TemplateView | null>(null);

  useEffect(() => {
    if (open) {
      setName(suggestedName);
      setSaved(null);
    }
  }, [open, suggestedName]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await api<{ template: TemplateView }>("/api/templates", {
        method: "POST",
        json: { name, fromProjectId: projectId },
      });
      setSaved(data.template);
      toast(`Saved ${data.template.name} as a template.`, "ok");
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
      title="Save as template"
      description="Keeps this brief's settings under a name, so the next project starts where this one did. Due date and project notes are left out."
      width={440}
    >
      {saved ? (
        <div className="space-y-4">
          <p className="text-[13px] text-chalk-dim leading-relaxed">
            <span className="text-chalk">{saved.name}</span> is saved as v1. Pick it when you start
            a project, or tidy it up in the template editor.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="quiet" onClick={onClose}>
              Done
            </Button>
            <Link
              href={`/app/templates/${saved.id}`}
              className="inline-flex items-center h-9.5 px-4 rounded-[10px] text-[13.5px] font-medium bg-white/[0.055] text-chalk border border-white/[0.09] hover:bg-white/[0.09]"
            >
              Open template
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Labeled label="Template name" required>
            <input
              autoFocus
              required
              className="field"
              placeholder="Gym edit, fast, 9:16"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Labeled>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Save template
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
