import Link from "next/link";
import { one } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { AcceptInvite } from "./accept";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const invite = one<{
    email: string;
    role: string;
    accepted_at: number | null;
    workspace_name: string;
    inviter: string | null;
  }>(
    `SELECT i.email, i.role, i.accepted_at, w.name AS workspace_name, u.name AS inviter
       FROM invites i
       JOIN workspaces w ON w.id = i.workspace_id
       LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.token = ?`,
    token,
  );

  const user = await currentUser();

  return (
    <div className="min-h-dvh grid place-items-center p-6">
      <div className="w-full max-w-[440px] glass rounded-[18px] p-8 animate-rise">
        {!invite || invite.accepted_at ? (
          <>
            <h1 className="text-display text-[26px]">This link has expired</h1>
            <p className="text-[13.5px] text-mute mt-3 leading-relaxed">
              The invite has either been used already or was revoked. Ask
              whoever invited you to send a fresh link.
            </p>
            <Link
              href="/"
              className="mt-7 h-10 px-4 inline-flex items-center rounded-[10px] border border-white/15 text-[13.5px] text-chalk-dim hover:text-chalk hover:border-white/25 transition-colors"
            >
              Back to Cutlist
            </Link>
          </>
        ) : (
          <>
            <span className="text-eyebrow">Invitation</span>
            <h1 className="text-display text-[26px] mt-3 leading-tight">
              Join {invite.workspace_name}
            </h1>
            <p className="text-[13.5px] text-mute mt-3 leading-relaxed">
              {invite.inviter ? `${invite.inviter} invited ` : "You were invited as "}
              <span className="text-chalk-dim">{invite.email}</span>
              {invite.inviter ? " you" : ""} to collaborate as{" "}
              <span className="text-signal">{invite.role}</span>.
            </p>

            <div className="rule-x my-6" />

            {user ? (
              <AcceptInvite token={token} workspace={invite.workspace_name} />
            ) : (
              <div className="space-y-3">
                <Link
                  href={`/signup?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(invite.email)}`}
                  className="h-11 w-full inline-flex items-center justify-center rounded-[11px] bg-signal text-ink-950 text-[14px] font-semibold hover:bg-[#e2ff77] transition-colors"
                >
                  Create an account and join
                </Link>
                <Link
                  href="/login"
                  className="h-11 w-full inline-flex items-center justify-center rounded-[11px] border border-white/15 text-[14px] text-chalk-dim hover:text-chalk hover:border-white/25 transition-colors"
                >
                  I already have an account
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
