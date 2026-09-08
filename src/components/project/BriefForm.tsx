"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Check, Lock } from "lucide-react";
import { Chip, Labeled, Meter, Spinner, useToast } from "@/components/ui";
import {
  BRIEF_SECTIONS,
  completeness,
  missingRequired,
  type BriefField,
  type BriefValues,
} from "@/lib/brief";
import { api } from "./useProject";

export function BriefForm({
  projectId,
  initial,
  canEdit,
}: {
  projectId: string;
  initial: BriefValues;
  canEdit: boolean;
}) {
  const toast = useToast();
  const [values, setValues] = useState<BriefValues>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(values);

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

      <div className="space-y-5">
        {BRIEF_SECTIONS.map((section) => (
          <section key={section.id} className="glass rounded-[15px] overflow-hidden">
            <div className="px-5 pt-4 pb-3">
              <h3 className="text-[14px] font-semibold text-chalk">
                {section.title}
              </h3>
              <p className="text-[12px] text-mute mt-1 leading-relaxed">
                {section.blurb}
              </p>
            </div>
            <div className="rule-x" />
            <div className="p-5 grid sm:grid-cols-2 gap-x-5 gap-y-4">
              {section.fields.map((field) => (
                <Field
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  onChange={(v) => update(field.key, v)}
                  disabled={!canEdit}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
  disabled,
}: {
  field: BriefField;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
  disabled: boolean;
}) {
  const wide = field.kind === "textarea" || field.kind === "multi";

  return (
    <Labeled
      label={field.label}
      hint={field.hint}
      required={field.required}
      className={wide ? "sm:col-span-2" : undefined}
    >
      {field.kind === "multi" ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {(field.options ?? []).map((option) => {
            const selected = Array.isArray(value) && value.includes(option);
            return (
              <Chip
                key={option}
                active={selected}
                color={selected ? "#d6f55e" : undefined}
                onClick={
                  disabled
                    ? undefined
                    : () => {
                        const current = Array.isArray(value) ? value : [];
                        onChange(
                          selected
                            ? current.filter((v) => v !== option)
                            : [...current, option],
                        );
                      }
                }
                className={clsx(disabled && "opacity-60 pointer-events-none")}
              >
                {option}
              </Chip>
            );
          })}
        </div>
      ) : field.kind === "select" ? (
        <select
          className="field appearance-none cursor-pointer"
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Not set</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.kind === "textarea" ? (
        <textarea
          rows={3}
          className="field resize-y min-h-[76px] leading-relaxed"
          disabled={disabled}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type={field.kind === "date" ? "date" : "text"}
          className="field"
          disabled={disabled}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Labeled>
  );
}
