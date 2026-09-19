import { requireCtx, can } from "@/lib/tenancy";
import { allSettings, listSecretHints } from "@/lib/ai/keys";
import { resolveStt, STT_PROVIDERS } from "@/lib/ai/stt";
import { resolveLlm, LLM_PROVIDERS } from "@/lib/ai/llm";
import { driveConfigured, getConnection } from "@/lib/drive";
import { listMembers } from "@/lib/queries";
import { many } from "@/lib/db";
import { SettingsView } from "@/components/settings/SettingsView";
import { WorkspaceModes } from "@/components/settings/WorkspaceModes";
import { ffmpegStatus } from "@/lib/analysis/ffmpeg";
import { getSetting } from "@/lib/ai/keys";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ drive?: string; detail?: string }>;
}) {
  const ctx = await requireCtx();
  const params = await searchParams;

  const privileged = can.manageSecrets(ctx.role);
  const stt = privileged ? resolveStt(ctx.workspace.id) : null;
  const llm = privileged ? resolveLlm(ctx.workspace.id) : null;
  const drive = privileged ? getConnection(ctx.workspace.id) : null;

  const invites = can.manageMembers(ctx.role)
    ? many<{ id: string; email: string; role: string; token: string; created_at: number }>(
        "SELECT id, email, role, token, created_at FROM invites WHERE workspace_id = ? AND accepted_at IS NULL ORDER BY created_at DESC",
        ctx.workspace.id,
      )
    : [];

  const ffmpeg = ffmpegStatus();

  return (
    <>
      <SettingsView
      workspace={{ id: ctx.workspace.id, name: ctx.workspace.name, slug: ctx.workspace.slug }}
      role={ctx.role}
      me={ctx.user.id}
      secrets={privileged ? listSecretHints(ctx.workspace.id) : []}
      settings={privileged ? allSettings(ctx.workspace.id) : {}}
      sttProviders={STT_PROVIDERS.map((p) => ({ ...p }))}
      llmProviders={LLM_PROVIDERS.map((p) => ({ ...p }))}
      active={{
        stt: stt ? { provider: stt.provider.id, label: stt.provider.label, model: stt.model } : null,
        llm: llm ? { provider: llm.provider.id, label: llm.provider.label, model: llm.model } : null,
      }}
      drive={{
        available: driveConfigured(),
        connected: Boolean(drive),
        accountEmail: drive?.account_email ?? null,
      }}
      members={listMembers(ctx)}
      invites={invites}
      flash={params.drive ? { status: params.drive, detail: params.detail } : null}
      />
      <div className="px-5 sm:px-8 pb-12 max-w-[980px]">
        <WorkspaceModes
          solo={getSetting(ctx.workspace.id, "SOLO_MODE") === "on"}
          ffmpeg={{ ok: ffmpeg.ok, hint: ffmpeg.hint }}
          canManage={can.manageSecrets(ctx.role)}
        />
      </div>
    </>
  );
}
