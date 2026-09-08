"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  Check,
  ChevronsUpDown,
  LayoutGrid,
  LogOut,
  Menu,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { Avatar, Button, Modal, useToast } from "@/components/ui";
import type { Role, Workspace } from "@/lib/types";

interface Props {
  user: { id: string; name: string; email: string };
  workspace: Workspace & { role: Role };
  workspaces: (Workspace & { role: Role })[];
  projects: { id: string; name: string; status: string; open_count: number }[];
  children: React.ReactNode;
}

const ROLE_COPY: Record<Role, string> = {
  owner: "Owner",
  creator: "Creator",
  editor: "Editor",
  viewer: "Viewer",
};

export function AppShell({
  user,
  workspace,
  workspaces,
  projects,
  children,
}: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[254px_1fr]">
      <a href="#content" className="skip-to-content">
        Skip to content
      </a>

      {/* Mobile bar */}
      <div className="lg:hidden sticky top-0 z-40 glass-deep h-14 flex items-center justify-between px-4">
        <button
          onClick={() => setMobileOpen(true)}
          className="size-9 -ml-1.5 grid place-items-center rounded-lg text-chalk-dim hover:bg-white/[0.06]"
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>
        <span className="text-display text-[15px] truncate">{workspace.name}</span>
        <Avatar name={user.name} seed={user.id} size={26} />
      </div>

      {mobileOpen ? (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-ink-950/70 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-[268px] glass-deep animate-rise">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-3.5 right-3.5 size-8 grid place-items-center rounded-lg text-faint hover:text-chalk hover:bg-white/[0.06]"
              aria-label="Close navigation"
            >
              <X size={16} />
            </button>
            <SidebarBody
              user={user}
              workspace={workspace}
              workspaces={workspaces}
              projects={projects}
              pathname={pathname}
            />
          </div>
        </div>
      ) : null}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col sticky top-0 h-dvh border-r border-white/[0.06]">
        <SidebarBody
          user={user}
          workspace={workspace}
          workspaces={workspaces}
          projects={projects}
          pathname={pathname}
        />
      </aside>

      <main id="content" className="min-w-0">
        {children}
      </main>
    </div>
  );
}

function SidebarBody({
  user,
  workspace,
  workspaces,
  projects,
  pathname,
}: Omit<Props, "children"> & { pathname: string }) {
  const router = useRouter();
  const toast = useToast();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function switchTo(id: string) {
    if (id === workspace.id) return setSwitcherOpen(false);
    await fetch("/api/workspaces/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: id }),
    });
    setSwitcherOpen(false);
    router.push("/app");
    router.refresh();
  }

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewWorkspace(false);
      setName("");
      router.push("/app");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  const active = projects.filter((p) => p.status !== "archived").slice(0, 12);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Workspace switcher */}
      <div className="p-3 relative">
        <button
          onClick={() => setSwitcherOpen((v) => !v)}
          className="w-full flex items-center gap-2.5 rounded-[11px] px-2.5 py-2.5 hover:bg-white/[0.055] transition-colors text-left"
        >
          <span className="relative grid place-items-center size-7 shrink-0 rounded-[9px] bg-signal/12 border border-signal/25">
            <span className="absolute inset-x-[7px] top-[7px] h-px bg-signal/70" />
            <span className="absolute left-[9px] bottom-[6px] w-px h-2.5 bg-signal" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium text-chalk truncate">
              {workspace.name}
            </span>
            <span className="block text-[11px] text-faint">
              {ROLE_COPY[workspace.role]}
            </span>
          </span>
          <ChevronsUpDown size={14} className="text-faint shrink-0" />
        </button>

        {switcherOpen ? (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setSwitcherOpen(false)}
            />
            <div className="absolute left-3 right-3 top-[calc(100%-4px)] z-20 glass-deep rounded-[12px] p-1.5 animate-rise">
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => switchTo(ws.id)}
                  className="w-full flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-left hover:bg-white/[0.06] transition-colors"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-chalk truncate">
                      {ws.name}
                    </span>
                    <span className="block text-[10.5px] text-faint">
                      {ROLE_COPY[ws.role]}
                    </span>
                  </span>
                  {ws.id === workspace.id ? (
                    <Check size={13} className="text-signal shrink-0" />
                  ) : null}
                </button>
              ))}
              <div className="rule-x my-1.5" />
              <button
                onClick={() => {
                  setSwitcherOpen(false);
                  setNewWorkspace(true);
                }}
                className="w-full flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-[13px] text-mute hover:text-chalk hover:bg-white/[0.06] transition-colors"
              >
                <Plus size={13} />
                New workspace
              </button>
            </div>
          </>
        ) : null}
      </div>

      <nav className="px-3 space-y-0.5">
        <NavLink
          href="/app"
          icon={<LayoutGrid size={15} />}
          active={pathname === "/app"}
        >
          Overview
        </NavLink>
        <NavLink
          href="/app/settings"
          icon={<Settings size={15} />}
          active={pathname.startsWith("/app/settings")}
        >
          Settings
        </NavLink>
      </nav>

      <div className="mt-6 px-3 flex items-center justify-between">
        <span className="text-eyebrow">Projects</span>
        <span className="text-[10.5px] tabular text-faint">{active.length}</span>
      </div>

      <div className="mt-2 px-3 flex-1 min-h-0 overflow-y-auto pb-4 space-y-0.5">
        {active.length === 0 ? (
          <p className="text-[12px] text-faint px-2.5 py-2 leading-relaxed">
            No projects yet.
          </p>
        ) : (
          active.map((project) => (
            <Link
              key={project.id}
              href={`/app/projects/${project.id}`}
              className={clsx(
                "flex items-center gap-2 rounded-[9px] px-2.5 py-[7px] text-[13px] transition-colors group",
                pathname.startsWith(`/app/projects/${project.id}`)
                  ? "bg-white/[0.075] text-chalk"
                  : "text-mute hover:text-chalk-dim hover:bg-white/[0.04]",
              )}
            >
              <span className="truncate flex-1">{project.name}</span>
              {project.open_count > 0 ? (
                <span className="tabular text-[10px] text-faint group-hover:text-mute shrink-0">
                  {project.open_count}
                </span>
              ) : null}
            </Link>
          ))
        )}
      </div>

      <div className="p-3 border-t border-white/[0.06]">
        <div className="flex items-center gap-2.5 px-1.5 py-1">
          <Avatar name={user.name} seed={user.id} size={28} />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] text-chalk truncate">{user.name}</p>
            <p className="text-[10.5px] text-faint truncate">{user.email}</p>
          </div>
          <button
            onClick={signOut}
            title="Sign out"
              aria-label="Sign out"
            className="size-7 grid place-items-center rounded-lg text-faint hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      <Modal
        open={newWorkspace}
        onClose={() => setNewWorkspace(false)}
        title="New workspace"
        description="A separate workspace for a separate client. Members, footage, cut lists and AI keys stay entirely apart."
        width={440}
      >
        <form onSubmit={createWorkspace} className="space-y-4">
          <input
            autoFocus
            required
            className="field"
            placeholder="Client or channel name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="quiet" onClick={() => setNewWorkspace(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Create workspace
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function NavLink({
  href,
  icon,
  active,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13.5px] transition-colors",
        active
          ? "bg-white/[0.075] text-chalk"
          : "text-mute hover:text-chalk-dim hover:bg-white/[0.04]",
      )}
    >
      <span className={active ? "text-signal" : ""}>{icon}</span>
      {children}
    </Link>
  );
}
