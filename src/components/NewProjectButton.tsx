"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Labeled, Modal, useToast } from "@/components/ui";

export function NewProjectButton({
  variant = "primary",
  label = "New project",
}: {
  variant?: "primary" | "ghost";
  label?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOpen(false);
      setName("");
      setSummary("");
      setDue("");
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
      <Button variant={variant} icon={<Plus size={15} />} onClick={() => setOpen(true)}>
        {label}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Start a project"
        description="A project holds the footage, the brief, every note and the cut list for one video — or one batch of them."
        width={480}
      >
        <form onSubmit={create} className="space-y-4">
          <Labeled label="Project name" required>
            <input
              autoFocus
              required
              className="field"
              placeholder="Ep. 42 — the studio tour"
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
            <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Create project
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
