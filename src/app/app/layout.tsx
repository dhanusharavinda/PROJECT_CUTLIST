import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { requireCtx } from "@/lib/tenancy";
import { many } from "@/lib/db";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await currentUser())) redirect("/login");

  const ctx = await requireCtx();

  const projects = many<{
    id: string;
    name: string;
    status: string;
    open_count: number;
  }>(
    `SELECT p.id, p.name, p.status,
            (SELECT COUNT(*) FROM labels l WHERE l.project_id = p.id AND l.status IN ('open','doing')) AS open_count
       FROM projects p
      WHERE p.workspace_id = ?
      ORDER BY p.updated_at DESC`,
    ctx.workspace.id,
  );

  return (
    <AppShell
      user={{ id: ctx.user.id, name: ctx.user.name, email: ctx.user.email }}
      workspace={{ ...ctx.workspace, role: ctx.role }}
      workspaces={ctx.workspaces}
      projects={projects}
    >
      {children}
    </AppShell>
  );
}
