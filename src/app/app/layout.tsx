import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { HttpError, requireCtx, type Ctx } from "@/lib/tenancy";
import { many } from "@/lib/db";
import { AppShell } from "@/components/AppShell";
import { FallbackLink, FullPageState } from "@/components/Fallback";
import { SignOutLink } from "@/components/SignOutLink";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await currentUser())) redirect("/login");

  let ctx: Ctx;
  try {
    ctx = await requireCtx();
  } catch (err) {
    // Reachable in one real case: you were removed from the only workspace you
    // belonged to while signed in. Without this it renders a raw 403.
    if (err instanceof HttpError && err.status === 403) {
      return (
        <FullPageState
          eyebrow="No workspace"
          title="You’re not in a workspace"
          body="Your membership was removed, or the workspace was deleted. Ask whoever runs it for a fresh invite link, or start one of your own."
          actions={
            <>
              <FallbackLink href="/signup" primary>
                Create a workspace
              </FallbackLink>
              <SignOutLink />
            </>
          }
        />
      );
    }
    throw err;
  }

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
