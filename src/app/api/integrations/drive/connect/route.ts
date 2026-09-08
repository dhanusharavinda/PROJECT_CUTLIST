import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { assert, can, requireCtx } from "@/lib/tenancy";
import { driveAuthUrl } from "@/lib/drive";
import { randomToken, sign } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const ctx = await requireCtx();
  assert(can.manageSecrets(ctx.role), "Only owners and creators can connect Drive.");

  // The state is signed so the callback can trust which workspace to attach the
  // tokens to without trusting a query parameter.
  const state = sign(
    `${ctx.workspace.id}:${ctx.user.id}:${randomToken(9)}`,
  );

  return NextResponse.redirect(driveAuthUrl(state));
});
