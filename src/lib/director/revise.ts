import type { Ctx } from "../tenancy";
import { complete, parseJson } from "../ai/llm";
import { listRecommendations } from "../graph/recommendations";
import { recordEvent } from "../graph/events";
import { runDirector, SCOPES, type DirectorResult, type Scope } from "./run";

/**
 * "Ask AI to revise."
 *
 * Two steps, on purpose. The fast tier first turns the creator's sentence into
 * a scope: what may change, what is locked. Only then does the director run,
 * limited to those parts, on the deep tier. The lock is enforced twice: named
 * to the model, and filtered on the way out, so "leave the hook alone" cannot
 * be lost to a model having a good idea.
 */

export interface RevisionPlan {
  modify: Scope[];
  lock: Scope[];
  summary: string;
}

function asScopes(value: unknown): Scope[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v).toLowerCase().trim())
    .filter((v): v is Scope => (SCOPES as readonly string[]).includes(v));
}

export async function planRevision(ctx: Ctx, projectId: string, request: string): Promise<{ plan: RevisionPlan; runId: string }> {
  const live = listRecommendations(ctx, projectId, { live: true });
  const existing = live
    .slice(0, 40)
    .map((r) => `- [${r.scope}] ${r.type}: ${r.title} (${r.status})`)
    .join("\n");

  const result = await complete(ctx.workspace.id, {
    tier: "fast",
    task: "revise-scope",
    projectId,
    json: true,
    maxTokens: 300,
    system: `You turn a creator's request into a scope for a revision. The parts of an edit are: hook (first fifteen percent), body, close (last fifteen percent), audio (music and sound), text (captions and on-screen text), whole (project-wide).

Return {"modify": [parts that may change], "lock": [parts the creator said to leave alone], "summary": "one sentence restating the request"}. If the request names nothing specific, modify is ["whole"] and lock is []. Never put the same part in both lists. No em dashes.`,
    user: `Request: ${request}

Current suggestions, by part:
${existing || "(none)"}`,
  });

  const parsed = parseJson<{ modify?: unknown; lock?: unknown; summary?: unknown }>(result.text);
  let modify = asScopes(parsed?.modify);
  const lock = asScopes(parsed?.lock).filter((s) => !modify.includes(s));
  if (modify.length === 0) modify = ["whole"];
  // "whole" plus specific locks means everything except those parts.
  if (modify.includes("whole") && lock.length > 0) {
    modify = SCOPES.filter((s) => s !== "whole" && !lock.includes(s));
  }

  return {
    plan: { modify, lock, summary: String(parsed?.summary ?? request).slice(0, 300) },
    runId: result.runId,
  };
}

export async function reviseWithAi(
  ctx: Ctx,
  projectId: string,
  request: string,
): Promise<{ plan: RevisionPlan; result: DirectorResult }> {
  const { plan, runId } = await planRevision(ctx, projectId, request);

  recordEvent(ctx, projectId, {
    kind: "director.scoped",
    actorKind: "ai",
    subjectType: "project",
    subjectId: projectId,
    payload: { run_id: runId, request, ...plan },
  });

  const result = await runDirector(ctx, projectId, {
    scopes: plan.modify,
    lock: plan.lock,
    request: plan.summary,
    tier: "deep",
  });

  return { plan, result };
}
