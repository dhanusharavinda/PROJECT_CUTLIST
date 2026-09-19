"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BookMarked, Plus } from "lucide-react";
import { Button, Labeled, Modal, useToast } from "@/components/ui";
import {
  TemplateChoiceList,
  useTemplates,
} from "@/components/templates/TemplatePicker";
import type { TemplateView } from "@/lib/templates/store";

type Step = "choose" | "details";

export function NewProjectButton({
  variant = "primary",
  size = "md",
  label = "New project",
  templateId,
}: {
  variant?: "primary" | "ghost" | "quiet";
  size?: "sm" | "md";
  label?: string;
  /** Skip the choice and start from this template, as the library's "Use template" does. */
  templateId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  // undefined: not decided yet. null: from scratch.
  const [chosen, setChosen] = useState<TemplateView | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  const { templates, loading } = useTemplates(open);

  // Decide the first screen once the list is in: a preselected template goes
  // straight to the details, and so does a workspace with no templates at all.
  useEffect(() => {
    if (!open || templates === null || chosen !== undefined) return;
    if (templateId) {
      const found = templates.find((t) => t.id === templateId) ?? null;
      setChosen(found);
      setStep("details");
      return;
    }
    if (templates.length === 0) {
      setChosen(null);
      setStep("details");
    }
  }, [open, templates, templateId, chosen]);

  function reset() {
    setStep("choose");
    setChosen(undefined);
    setName("");
    setSummary("");
    setDue("");
  }

  function close() {
    setOpen(false);
    reset();
  }

  function pick(template: TemplateView | null) {
    setChosen(template);
    setStep("details");
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          summary,
          dueAt: due ? new Date(`${due}T12:00:00`).getTime() : null,
          templateId: chosen?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      close();
      router.push(`/app/projects/${data.id}`);
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        icon={<Plus size={size === "sm" ? 13 : 15} />}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Start a project"
        description={
          step === "choose"
            ? "Begin with a template you have saved, or with an empty brief."
            : "A project holds the footage, the brief, every note and the cut list for one video, or one batch of them."
        }
        width={480}
      >
        {step === "choose" ? (
          <TemplateChoiceList
            templates={templates ?? []}
            loading={loading}
            selectedId={chosen === undefined ? undefined : (chosen?.id ?? null)}
            onPick={pick}
          />
        ) : (
          <form onSubmit={create} className="space-y-4">
            <p className="flex items-center justify-between gap-3 text-[12.5px] text-mute glass-soft rounded-[11px] px-3.5 py-2.5">
              <span className="flex items-center gap-2 min-w-0">
                <BookMarked size={13} className="text-faint shrink-0" aria-hidden />
                {chosen ? (
                  <span className="truncate">
                    Starting from <span className="text-chalk-dim">{chosen.name}</span> v
                    {chosen.current_version}
                  </span>
                ) : (
                  <span>Starting from scratch</span>
                )}
              </span>
              {(templates?.length ?? 0) > 0 ? (
                <button
                  type="button"
                  onClick={() => setStep("choose")}
                  className="text-[12px] text-chalk-dim hover:text-chalk shrink-0"
                >
                  Change
                </button>
              ) : null}
            </p>

            <Labeled label="Project name" required>
              <input
                autoFocus
                required
                className="field"
                placeholder="Ep. 42: the studio tour"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Labeled>

            <Labeled
              label="One-line summary"
              hint="What the editor should know before opening anything."
            >
              <input
                className="field"
                placeholder="Long-form YouTube, needs a vertical cut too"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </Labeled>

            <Labeled label="Due date">
              <input
                type="date"
                className="field"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </Labeled>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="quiet" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                Create project
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
