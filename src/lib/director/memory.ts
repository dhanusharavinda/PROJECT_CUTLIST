import { many } from "../db";
import type { Ctx } from "../tenancy";
import { guardrailsOf, type BriefValues } from "../brief";
import type { RecommendationType } from "../graph/recommendations";

/**
 * Style memory: what this creator tends to do.
 *
 * Nothing is inferred from vibes. It is counted from decisions already made
 * across the workspace: which kinds of suggestion get accepted, which get
 * rejected, the exact suggestions turned down recently, the rules that
 * appear in brief after brief, and the template used most. The director
 * reads it before proposing, so it stops offering what the creator keeps
 * declining. The creator can read it too, on the Plan tab.
 */

export interface StyleMemory {
  sample_size: number;
  tendencies: string[];
  accepted: string[];
  rejected: string[];
  house_rules: string[];
  template: { name: string; uses: number; rules: string[] } | null;
}

const ACCEPTED = new Set(["approved", "converted", "modified"]);

function tally(rows: { type: string; status: string }[]) {
  const byType = new Map<string, { yes: number; no: number }>();
  for (const row of rows) {
    const entry = byType.get(row.type) ?? { yes: 0, no: 0 };
    if (ACCEPTED.has(row.status)) entry.yes += 1;
    else if (row.status === "rejected") entry.no += 1;
    byType.set(row.type, entry);
  }
  return byType;
}

export function styleMemory(ctx: Ctx, projectId: string | null = null): StyleMemory {
  const decisions = many<{ type: RecommendationType; status: string; title: string; project_id: string }>(
    `SELECT type, status, title, project_id FROM recommendations
     WHERE workspace_id = ? AND status IN ('approved','converted','modified','rejected')
     ORDER BY updated_at DESC LIMIT 400`,
    ctx.workspace.id,
  );

  const tendencies: string[] = [];
  for (const [type, { yes, no }] of tally(decisions)) {
    const total = yes + no;
    if (total < 3) continue;
    if (yes / total >= 0.75) tendencies.push(`Usually accepts ${type} suggestions (${yes} of ${total}).`);
    else if (no / total >= 0.75) tendencies.push(`Usually turns down ${type} suggestions (${no} of ${total}).`);
  }

  const seen = new Set<string>();
  const pick = (status: (s: string) => boolean) =>
    decisions
      .filter((d) => status(d.status))
      .map((d) => d.title.trim())
      .filter((t) => {
        const key = t.toLowerCase();
        if (!t || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);
  const rejected = pick((s) => s === "rejected");
  const accepted = pick((s) => ACCEPTED.has(s));

  // Rules that keep coming back across briefs are house rules, not one-offs.
  const briefs = many<{ payload: string; project_id: string }>(
    "SELECT payload, project_id FROM briefs WHERE workspace_id = ?",
    ctx.workspace.id,
  );
  const ruleCount = new Map<string, { n: number; text: string }>();
  for (const brief of briefs) {
    let values: BriefValues = {};
    try {
      values = JSON.parse(brief.payload) as BriefValues;
    } catch {
      continue;
    }
    for (const rule of guardrailsOf(values)) {
      const key = rule.toLowerCase().replace(/\s+/g, " ").trim();
      if (key.length < 4) continue;
      const entry = ruleCount.get(key) ?? { n: 0, text: rule.trim() };
      entry.n += 1;
      ruleCount.set(key, entry);
    }
  }
  const house_rules = [...ruleCount.values()]
    .filter((r) => r.n >= 2 || briefs.length <= 1)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)
    .map((r) => (r.n > 1 ? `${r.text} (${r.n} briefs)` : r.text));

  const top = many<{ name: string; usage_count: number; payload: string }>(
    `SELECT t.name, t.usage_count, v.payload
     FROM templates t
     JOIN template_versions v ON v.template_id = t.id AND v.version = t.current_version
     WHERE t.workspace_id = ? AND t.archived_at IS NULL
     ORDER BY t.usage_count DESC, t.updated_at DESC LIMIT 1`,
    ctx.workspace.id,
  )[0];
  let template: StyleMemory["template"] = null;
  if (top && top.usage_count > 0) {
    let rules: string[] = [];
    try {
      const payload = JSON.parse(top.payload) as { brief?: BriefValues };
      const brief = payload.brief ?? {};
      rules = [brief.editingRules, brief.aiInstructions]
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .flatMap((v) => v.split(/\r?\n/))
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 6);
    } catch {
      /* an unreadable payload contributes nothing */
    }
    template = { name: top.name, uses: top.usage_count, rules };
  }

  void projectId;
  return { sample_size: decisions.length, tendencies, accepted, rejected, house_rules, template };
}

/** The memory as a block the director can read. Empty when there is nothing counted yet. */
export function memoryPrompt(memory: StyleMemory): string {
  const lines: string[] = [];
  if (memory.tendencies.length) lines.push(...memory.tendencies.map((t) => `- ${t}`));
  if (memory.rejected.length) lines.push(`- Turned down before, do not propose again: ${memory.rejected.join("; ")}`);
  if (memory.accepted.length) lines.push(`- Liked before: ${memory.accepted.join("; ")}`);
  if (memory.house_rules.length) lines.push(`- House rules across briefs: ${memory.house_rules.join("; ")}`);
  if (memory.template) {
    lines.push(
      `- Favourite template: ${memory.template.name} (${memory.template.uses} uses)${memory.template.rules.length ? `: ${memory.template.rules.join("; ")}` : ""}`,
    );
  }
  return lines.length ? `WHAT THIS CREATOR TENDS TO DO (counted from ${memory.sample_size} decisions):\n${lines.join("\n")}` : "";
}
