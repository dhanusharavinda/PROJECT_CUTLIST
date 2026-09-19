"use client";

import clsx from "clsx";
import { Chip, Labeled } from "@/components/ui";
import type { BriefField, BriefSection, BriefValues } from "@/lib/brief";

/**
 * The brief's fields, rendered from the schema and nothing else.
 *
 * Presentational on purpose: the project brief wraps it with autosave and a
 * completeness meter, the template editor wraps it with versioning. Both show
 * the same cards and the same controls, so a template never looks like a
 * second, slightly different brief.
 */
export function BriefFields({
  sections,
  values,
  onChange,
  disabled = false,
}: {
  sections: BriefSection[];
  values: BriefValues;
  onChange: (key: string, value: string | string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <section key={section.id} className="glass rounded-[15px] overflow-hidden">
          <div className="px-5 pt-4 pb-3">
            <h3 className="text-[14px] font-semibold text-chalk">{section.title}</h3>
            <p className="text-[12px] text-mute mt-1 leading-relaxed">{section.blurb}</p>
          </div>
          <div className="rule-x" />
          <div className="p-5 grid sm:grid-cols-2 gap-x-5 gap-y-4">
            {section.fields.map((field) => (
              <Field
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={(v) => onChange(field.key, v)}
                disabled={disabled}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function Field({
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
