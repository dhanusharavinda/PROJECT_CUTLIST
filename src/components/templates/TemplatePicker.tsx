"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, FilePlus2, Star } from "lucide-react";
import { Modal, Spinner } from "@/components/ui";
import { api } from "@/components/project/useProject";
import type { TemplateView } from "@/lib/templates/store";

/**
 * Pick a template, or none.
 *
 * Used twice: as the first screen of "Start a project", and behind "Apply a
 * template" on the brief. The list itself is exported so the new project
 * modal can show it inline without a dialog inside a dialog.
 */

export function useTemplates(active: boolean) {
  const [templates, setTemplates] = useState<TemplateView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setError(null);
    api<{ templates: TemplateView[] }>("/api/templates", { cache: "no-store" })
      .then((data) => {
        if (!cancelled) setTemplates(data.templates);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setTemplates([]);
          setError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return { templates, loading: active && templates === null, error };
}

export function TemplateChoiceList({
  templates,
  loading,
  selectedId,
  onPick,
  allowScratch = true,
  emptyHint = "No templates yet. Save one from a project's brief and it will show up here.",
}: {
  templates: TemplateView[];
  loading?: boolean;
  /** The template already chosen, if any. `null` means "from scratch". */
  selectedId?: string | null;
  onPick: (template: TemplateView | null) => void;
  allowScratch?: boolean;
  emptyHint?: string;
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-mute py-6 justify-center">
        <Spinner /> Loading templates
      </p>
    );
  }

  return (
    <ul className="space-y-2" role="list">
      {allowScratch ? (
        <li>
          <ChoiceRow
            selected={selectedId === null}
            onClick={() => onPick(null)}
            icon={<FilePlus2 size={15} className="text-faint" />}
            name="Start from scratch"
            meta="An empty brief. You can apply a template later."
          />
        </li>
      ) : null}

      {templates.length === 0 ? (
        <li className="text-[12.5px] text-mute leading-relaxed px-1 py-3">{emptyHint}</li>
      ) : (
        templates.map((template) => (
          <li key={template.id}>
            <ChoiceRow
              selected={selectedId === template.id}
              onClick={() => onPick(template)}
              icon={
                template.favourite ? (
                  <Star size={14} className="text-signal fill-signal" aria-label="Favourite" />
                ) : null
              }
              name={template.name}
              meta={[template.category, `v${template.current_version}`]
                .filter(Boolean)
                .join(" · ")}
              preview={template.preview}
            />
          </li>
        ))
      )}
    </ul>
  );
}

function ChoiceRow({
  selected,
  onClick,
  icon,
  name,
  meta,
  preview,
}: {
  selected: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  name: string;
  meta?: string;
  preview?: { label: string; value: string }[];
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        "w-full text-left rounded-[12px] px-3.5 py-3 border transition-colors",
        selected
          ? "bg-signal/[0.08] border-signal/35"
          : "glass-soft border-transparent hover:bg-white/[0.06]",
      )}
    >
      <span className="flex items-center gap-2.5">
        {icon ? <span className="shrink-0 inline-flex">{icon}</span> : null}
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] text-chalk truncate">{name}</span>
          {meta ? <span className="block text-[11px] text-faint mt-0.5">{meta}</span> : null}
        </span>
        {selected ? <Check size={14} className="text-signal shrink-0" aria-hidden /> : null}
      </span>
      {preview && preview.length ? (
        <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {preview.map((pair) => (
            <span key={pair.label} className="text-[11px] leading-snug">
              <span className="text-faint">{pair.label}: </span>
              <span className="text-chalk-dim">{pair.value}</span>
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
}

export function TemplatePicker({
  open,
  onClose,
  onPick,
  title = "Apply a template",
  description = "Fills only the fields that are still empty. Nothing you have already written changes.",
  allowScratch = false,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (template: TemplateView | null) => void;
  title?: string;
  description?: string;
  allowScratch?: boolean;
}) {
  const { templates, loading, error } = useTemplates(open);

  return (
    <Modal open={open} onClose={onClose} title={title} description={description} width={520}>
      {error ? <p className="text-[12.5px] text-danger mb-3">{error}</p> : null}
      <TemplateChoiceList
        templates={templates ?? []}
        loading={loading}
        allowScratch={allowScratch}
        onPick={(template) => {
          onPick(template);
          onClose();
        }}
      />
    </Modal>
  );
}
