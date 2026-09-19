"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  Archive,
  ArchiveRestore,
  BookMarked,
  Copy,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { Button, Chip, Empty, Labeled, Modal, Panel, useToast } from "@/components/ui";
import { NewProjectButton } from "@/components/NewProjectButton";
import { api } from "@/components/project/useProject";
import { relativeTime } from "@/lib/format";
import type { TemplateView } from "@/lib/templates/store";

/**
 * Every template in the workspace.
 *
 * A template is creative intent with a name on it: platform, pacing, style,
 * rules. Never footage. The cards show enough to tell two apart; the editor
 * page has the rest.
 */
export function TemplateLibrary({
  templates: initial,
  canEdit,
}: {
  templates: TemplateView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [templates, setTemplates] = useState(initial);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<TemplateView | null>(null);
  const [deleting, setDeleting] = useState<TemplateView | null>(null);

  useEffect(() => setTemplates(initial), [initial]);

  useEffect(() => {
    if (!showArchived) return;
    let cancelled = false;
    api<{ templates: TemplateView[] }>("/api/templates?archived=1", { cache: "no-store" })
      .then((data) => {
        if (!cancelled) setTemplates(data.templates);
      })
      .catch((err: Error) => toast(err.message, "error"));
    return () => {
      cancelled = true;
    };
  }, [showArchived, toast]);

  const shown = showArchived ? templates : templates.filter((t) => !t.archived);
  const archivedCount = templates.filter((t) => t.archived).length;

  function replace(next: TemplateView) {
    setTemplates((current) => current.map((t) => (t.id === next.id ? next : t)));
  }

  async function patch(template: TemplateView, changes: Record<string, unknown>) {
    setBusy(template.id);
    try {
      const data = await api<{ template: TemplateView }>(`/api/templates/${template.id}`, {
        method: "PATCH",
        json: changes,
      });
      replace(data.template);
      return data.template;
    } catch (err) {
      toast((err as Error).message, "error");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function duplicate(template: TemplateView) {
    setBusy(template.id);
    try {
      const data = await api<{ template: TemplateView }>(
        `/api/templates/${template.id}/duplicate`,
        { method: "POST" },
      );
      setTemplates((current) => [data.template, ...current]);
      toast(`Duplicated as ${data.template.name}.`, "ok");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove(template: TemplateView) {
    setBusy(template.id);
    try {
      await api(`/api/templates/${template.id}`, { method: "DELETE" });
      setTemplates((current) => current.filter((t) => t.id !== template.id));
      setDeleting(null);
      toast(`Deleted ${template.name}. Projects made from it keep their brief.`, "ok");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-5 sm:px-8 py-7 max-w-[1180px]">
      <header>
        <span className="text-eyebrow">Workspace</span>
        <h1 className="text-display text-[clamp(1.8rem,3vw,2.4rem)] mt-2">Templates</h1>
        <p className="text-[13.5px] text-mute mt-2 max-w-[62ch] leading-relaxed">
          The settings your edits share, saved once and reused: platform, pacing, style, rules.
          A template is never footage. Editing one makes a new version, and projects you already
          started keep the version they were made from.
        </p>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="text-[11.5px] tabular text-faint">
          {shown.length} template{shown.length === 1 ? "" : "s"}
        </span>
        <label className="ml-auto flex items-center gap-2 text-[12px] text-mute cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-[#d6f55e]"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
          {archivedCount > 0 ? <span className="tabular text-faint">({archivedCount})</span> : null}
        </label>
      </div>

      {shown.length === 0 ? (
        <Panel className="mt-6">
          <Empty
            icon={<BookMarked size={18} />}
            title={showArchived ? "Nothing here" : "No templates yet"}
            hint="A template is saved from a project's brief. Open a project, fill in the Brief tab, then choose Save as template."
            action={
              canEdit && !showArchived ? (
                <Link
                  href="/app"
                  className="inline-flex items-center h-9.5 px-4 rounded-[10px] text-[13.5px] font-medium bg-white/[0.055] text-chalk border border-white/[0.09] hover:bg-white/[0.09]"
                >
                  Save your first template
                </Link>
              ) : null
            }
          />
        </Panel>
      ) : (
        <div className="mt-5 grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {shown.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              canEdit={canEdit}
              busy={busy === template.id}
              onFavourite={() => patch(template, { favourite: !template.favourite })}
              onArchive={() =>
                patch(template, { archived: !template.archived }).then((next) => {
                  if (next) toast(next.archived ? `Archived ${next.name}.` : `Restored ${next.name}.`, "ok");
                })
              }
              onDuplicate={() => duplicate(template)}
              onRename={() => setRenaming(template)}
              onDelete={() => setDeleting(template)}
            />
          ))}
        </div>
      )}

      <RenameModal
        template={renaming}
        onClose={() => setRenaming(null)}
        onSave={async (name) => {
          if (!renaming) return;
          const next = await patch(renaming, { name });
          if (next) {
            setRenaming(null);
            toast(`Renamed to ${next.name}.`, "ok");
          }
        }}
      />

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete template"
        description={
          deleting
            ? `${deleting.name} and all ${deleting.current_version} version${deleting.current_version === 1 ? "" : "s"} go away. Projects made from it keep their brief as it is.`
            : undefined
        }
        width={420}
      >
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setDeleting(null)}>
            Keep it
          </Button>
          <Button
            variant="danger"
            loading={busy === deleting?.id}
            onClick={() => deleting && remove(deleting)}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function TemplateCard({
  template,
  canEdit,
  busy,
  onFavourite,
  onArchive,
  onDuplicate,
  onRename,
  onDelete,
}: {
  template: TemplateView;
  canEdit: boolean;
  busy: boolean;
  onFavourite: () => void;
  onArchive: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const uses =
    template.usage_count === 0
      ? "not used yet"
      : `used ${template.usage_count} time${template.usage_count === 1 ? "" : "s"}`;

  return (
    <article
      className={clsx(
        "glass rounded-[14px] p-4 flex flex-col gap-3 relative",
        template.archived && "opacity-70",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/app/templates/${template.id}`}
            className="block text-[14px] font-medium text-chalk truncate hover:underline underline-offset-2"
          >
            {template.name}
          </Link>
          <p className="text-[11px] text-faint mt-1 tabular">
            v{template.current_version} · {uses} · {relativeTime(template.updated_at)}
          </p>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={onFavourite}
            disabled={busy}
            aria-label={template.favourite ? "Remove from favourites" : "Mark as favourite"}
            aria-pressed={template.favourite}
            className={clsx(
              "size-8 -mr-1.5 -mt-1 grid place-items-center rounded-lg transition-colors shrink-0",
              template.favourite
                ? "text-signal hover:bg-signal/10"
                : "text-faint hover:text-chalk hover:bg-white/[0.07]",
            )}
          >
            <Star size={15} className={template.favourite ? "fill-signal" : undefined} />
          </button>
        ) : template.favourite ? (
          <Star size={15} className="text-signal fill-signal shrink-0 mt-0.5" aria-label="Favourite" />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {template.category ? <Chip>{template.category}</Chip> : null}
        {template.archived ? <Chip>Archived</Chip> : null}
      </div>

      {template.description ? (
        <p className="text-[12px] text-mute leading-relaxed clamp-2">{template.description}</p>
      ) : null}

      {template.preview.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
          {template.preview.slice(0, 5).map((pair) => (
            <div key={pair.label} className="contents">
              <dt className="text-faint">{pair.label}</dt>
              <dd className="text-chalk-dim truncate">{pair.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[11.5px] text-faint">No settings yet. Open it to fill some in.</p>
      )}

      <div className="mt-auto pt-1 flex items-center gap-1">
        {canEdit && !template.archived ? (
          <NewProjectButton
            variant="ghost"
            size="sm"
            label="Use template"
            templateId={template.id}
          />
        ) : null}
        <Link
          href={`/app/templates/${template.id}`}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[10px] text-[12.5px] font-medium text-mute hover:text-chalk hover:bg-white/[0.055] transition-colors"
        >
          <Pencil size={12} aria-hidden />
          {canEdit ? "Edit" : "Open"}
        </Link>

        {canEdit ? (
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={`More actions for ${template.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={busy}
              className="size-8 grid place-items-center rounded-lg text-faint hover:text-chalk hover:bg-white/[0.07] transition-colors"
            >
              <MoreHorizontal size={15} />
            </button>
            {menuOpen ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div
                  role="menu"
                  className="absolute right-0 bottom-[calc(100%+4px)] z-20 w-44 glass-deep rounded-[12px] p-1.5 animate-rise"
                >
                  <MenuItem
                    icon={<Copy size={13} />}
                    onClick={() => {
                      setMenuOpen(false);
                      onDuplicate();
                    }}
                  >
                    Duplicate
                  </MenuItem>
                  <MenuItem
                    icon={<Pencil size={13} />}
                    onClick={() => {
                      setMenuOpen(false);
                      onRename();
                    }}
                  >
                    Rename
                  </MenuItem>
                  <MenuItem
                    icon={template.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                    onClick={() => {
                      setMenuOpen(false);
                      onArchive();
                    }}
                  >
                    {template.archived ? "Restore" : "Archive"}
                  </MenuItem>
                  <div className="rule-x my-1" />
                  <MenuItem
                    danger
                    icon={<Trash2 size={13} />}
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                  >
                    Delete
                  </MenuItem>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function MenuItem({
  icon,
  danger,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={clsx(
        "w-full flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-[13px] text-left transition-colors",
        danger
          ? "text-danger hover:bg-danger/10"
          : "text-chalk-dim hover:text-chalk hover:bg-white/[0.06]",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function RenameModal({
  template,
  onClose,
  onSave,
}: {
  template: TemplateView | null;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (template) setName(template.name);
  }, [template]);

  return (
    <Modal open={template !== null} onClose={onClose} title="Rename template" width={420}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await onSave(name.trim());
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-4"
      >
        <Labeled label="Name" required>
          <input
            autoFocus
            required
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Labeled>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Rename
          </Button>
        </div>
      </form>
    </Modal>
  );
}
