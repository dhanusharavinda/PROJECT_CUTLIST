"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, Lock } from "lucide-react";
import { Button, Labeled, Panel, PanelHeader, useToast } from "@/components/ui";
import { BriefFields } from "@/components/project/BriefFields";
import { api } from "@/components/project/useProject";
import { BRIEF_SECTIONS, STYLE_FIELDS, type BriefValues } from "@/lib/brief";
import { relativeTime } from "@/lib/format";
import type { TemplateView } from "@/lib/templates/store";

export interface TemplateVersionSummary {
  id: string;
  version: number;
  summary: string;
  created_at: number;
}

const CATEGORY_OPTIONS = STYLE_FIELDS.find((f) => f.key === "category")?.options ?? [];

/**
 * One template. Name and description save in place; the settings save as a
 * new version, so a project made from v2 keeps v2 when v3 lands.
 */
export function TemplateEditor({
  template: initial,
  versions: initialVersions,
  canEdit,
}: {
  template: TemplateView;
  versions: TemplateVersionSummary[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [template, setTemplate] = useState(initial);
  const [versions, setVersions] = useState(initialVersions);

  // Details, saved in place.
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [savingDetails, setSavingDetails] = useState(false);

  // Content, saved as a version. The category lives in the brief values and
  // is mirrored to the template's own column by the server on save.
  const [brief, setBrief] = useState<BriefValues>(initial.payload.brief);
  const [musicNote, setMusicNote] = useState(initial.payload.music_note);
  const [summary, setSummary] = useState("");
  const [savingVersion, setSavingVersion] = useState(false);

  const detailsDirty =
    name.trim() !== template.name || description.trim() !== template.description;

  const contentDirty = useMemo(
    () =>
      JSON.stringify(brief) !== JSON.stringify(template.payload.brief) ||
      musicNote !== template.payload.music_note,
    [brief, musicNote, template.payload],
  );

  const category = typeof brief.category === "string" ? brief.category : "";

  function updateBrief(key: string, value: string | string[]) {
    setBrief((current) => ({ ...current, [key]: value }));
  }

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    if (!detailsDirty) return;
    setSavingDetails(true);
    try {
      const data = await api<{ template: TemplateView }>(`/api/templates/${template.id}`, {
        method: "PATCH",
        json: { name: name.trim(), description: description.trim() },
      });
      setTemplate(data.template);
      toast("Details saved.", "ok");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSavingDetails(false);
    }
  }

  async function saveVersion(event: React.FormEvent) {
    event.preventDefault();
    setSavingVersion(true);
    try {
      const data = await api<{ template: TemplateView }>(
        `/api/templates/${template.id}/versions`,
        {
          method: "POST",
          json: {
            payload: { brief, niche: template.payload.niche, music_note: musicNote },
            summary: summary.trim() || undefined,
          },
        },
      );
      setTemplate(data.template);
      setBrief(data.template.payload.brief);
      setMusicNote(data.template.payload.music_note);
      setVersions((current) => [
        {
          id: data.template.version_id,
          version: data.template.current_version,
          summary: summary.trim() || `Version ${data.template.current_version}`,
          created_at: Date.now(),
        },
        ...current,
      ]);
      setSummary("");
      toast(`Saved as v${data.template.current_version}.`, "ok");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSavingVersion(false);
    }
  }

  return (
    <div className="px-5 sm:px-8 py-7 max-w-[1180px]">
      <Link
        href="/app/templates"
        className="inline-flex items-center gap-1.5 text-[12.5px] text-mute hover:text-chalk transition-colors"
      >
        <ArrowLeft size={13} aria-hidden />
        Templates
      </Link>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <span className="text-eyebrow">Template</span>
          <h1 className="text-display text-[clamp(1.6rem,3vw,2.2rem)] mt-2 truncate">
            {template.name}
          </h1>
          <p className="text-[12.5px] text-faint mt-1.5 tabular">
            v{template.current_version}
            {template.category ? ` · ${template.category}` : ""}
            {" · "}
            {template.usage_count === 0
              ? "not used yet"
              : `used ${template.usage_count} time${template.usage_count === 1 ? "" : "s"}`}
          </p>
        </div>
      </header>

      {!canEdit ? (
        <p className="mt-5 flex items-center gap-2 text-[12.5px] text-mute glass-soft rounded-[11px] px-3.5 py-2.5">
          <Lock size={13} className="shrink-0 text-faint" />
          Only the creator and workspace owner can change templates.
        </p>
      ) : null}

      <div className="mt-6 grid lg:grid-cols-[1fr_300px] gap-6 items-start">
        <div className="space-y-5 min-w-0">
          <Panel>
            <PanelHeader title="Details" eyebrow="Saved in place" />
            <div className="rule-x mx-5" />
            <form onSubmit={saveDetails} className="p-5 grid sm:grid-cols-2 gap-x-5 gap-y-4">
              <Labeled label="Name" required>
                <input
                  className="field"
                  required
                  disabled={!canEdit}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Labeled>
              <Labeled
                label="Content category"
                hint="Also sets the planner preset. Saved with the next version."
              >
                <select
                  className="field appearance-none cursor-pointer"
                  disabled={!canEdit}
                  value={category}
                  onChange={(e) => updateBrief("category", e.target.value)}
                >
                  <option value="">Not set</option>
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Labeled>
              <Labeled label="Description" className="sm:col-span-2">
                <input
                  className="field"
                  disabled={!canEdit}
                  placeholder="When to reach for this one"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Labeled>
              {canEdit ? (
                <div className="sm:col-span-2 flex justify-end">
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    disabled={!detailsDirty}
                    loading={savingDetails}
                  >
                    Save details
                  </Button>
                </div>
              ) : null}
            </form>
          </Panel>

          <BriefFields
            sections={BRIEF_SECTIONS}
            values={brief}
            onChange={updateBrief}
            disabled={!canEdit}
          />

          <section className="glass rounded-[15px] overflow-hidden">
            <div className="px-5 pt-4 pb-3">
              <h3 className="text-[14px] font-semibold text-chalk">Music</h3>
              <p className="text-[12px] text-mute mt-1 leading-relaxed">
                The track direction these reels are usually cut to, if there is a habit.
              </p>
            </div>
            <div className="rule-x" />
            <div className="p-5">
              <Labeled label="Music direction">
                <input
                  className="field"
                  disabled={!canEdit}
                  placeholder="Phonk around 140 BPM, drop within the first 3 seconds"
                  value={musicNote}
                  onChange={(e) => setMusicNote(e.target.value)}
                />
              </Labeled>
            </div>
          </section>

          {canEdit ? (
            <form
              onSubmit={saveVersion}
              className="glass-deep rounded-[15px] p-4 sm:p-5 sticky bottom-4 space-y-3"
            >
              <div>
                <p className="text-[13px] font-medium text-chalk">
                  Save as v{template.current_version + 1}
                </p>
                <p className="text-[12px] text-mute mt-0.5 leading-relaxed">
                  Every save is a new version. Projects already started from v
                  {template.current_version} or earlier keep what they have.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  className="field flex-1"
                  placeholder="What changed, in a line (optional)"
                  value={summary}
                  maxLength={200}
                  onChange={(e) => setSummary(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!contentDirty}
                  loading={savingVersion}
                  className="shrink-0"
                >
                  Save as v{template.current_version + 1}
                </Button>
              </div>
              {!contentDirty ? (
                <p className="text-[11.5px] text-faint flex items-center gap-1">
                  <Check size={12} aria-hidden /> Nothing changed since v{template.current_version}.
                </p>
              ) : null}
            </form>
          ) : null}
        </div>

        <Panel>
          <PanelHeader title="Versions" eyebrow={`${versions.length} so far`} />
          <div className="rule-x mx-5" />
          <ol className="px-5 py-3 divide-y divide-white/[0.06]">
            {versions.map((version) => (
              <li key={version.id} className="py-2.5 flex items-start gap-3">
                <span className="tabular text-[12px] text-signal shrink-0 w-7">
                  v{version.version}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] text-chalk-dim leading-snug">{version.summary}</p>
                  <p className="text-[11px] text-faint mt-0.5">{relativeTime(version.created_at)}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="px-5 pb-4 text-[11.5px] text-faint leading-relaxed">
            New projects use the newest version. A project remembers the one it started from.
          </p>
        </Panel>
      </div>
    </div>
  );
}
