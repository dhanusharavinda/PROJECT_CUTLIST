import { route } from "@/lib/api";
import { getProject, requireCtx } from "@/lib/tenancy";
import { listLabels, listNotes, listVideos, loadBrief } from "@/lib/queries";
import { briefForPrompt } from "@/lib/brief";
import { timecode } from "@/lib/format";
import { labelStyle } from "@/lib/labelStyle";

type Params = { params: Promise<{ projectId: string }> };

export const dynamic = "force-dynamic";

/**
 * The cut list, out of the app.
 *
 * Markdown for pasting into an editor's notes, CSV for a spreadsheet, JSON for
 * anything that wants to script against it. Not a project file — the point is
 * that the instructions survive outside Cutlist.
 */
export const GET = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;
  const project = getProject(ctx, projectId);

  const format = (new URL(req.url).searchParams.get("format") || "md").toLowerCase();
  const videos = listVideos(ctx, projectId);
  const labels = listLabels(ctx, projectId);
  const notes = listNotes(ctx, projectId);
  const brief = loadBrief(ctx, projectId);
  const titleById = new Map(videos.map((v) => [v.id, v.title]));
  const slug = project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  if (format === "json") {
    return new Response(
      JSON.stringify(
        {
          project: {
            name: project.name,
            summary: project.summary,
            status: project.status,
            due_at: project.due_at,
          },
          brief: briefForPrompt(brief.payload),
          videos: videos.map((v) => ({
            id: v.id,
            title: v.title,
            duration_ms: v.duration_ms,
            source: v.source,
          })),
          cutlist: labels.map((l) => ({
            clip: l.video_id ? titleById.get(l.video_id) : null,
            timecode: timecode(l.start_ms, true),
            start_ms: l.start_ms,
            end_ms: l.end_ms,
            type: l.type,
            title: l.title,
            detail: l.detail,
            priority: l.priority,
            status: l.status,
            origin: l.origin,
          })),
          transcripts: notes.map((n) => ({
            clip: n.video_id ? titleById.get(n.video_id) : null,
            anchor_ms: n.anchor_ms,
            kind: n.kind,
            text: n.text,
          })),
          exported_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${slug}-cutlist.json"`,
        },
      },
    );
  }

  if (format === "csv") {
    const rows = [
      ["clip", "timecode", "start_ms", "end_ms", "type", "priority", "status", "title", "detail"],
      ...labels.map((l) => [
        l.video_id ? (titleById.get(l.video_id) ?? "") : "",
        timecode(l.start_ms, true),
        String(l.start_ms),
        l.end_ms === null ? "" : String(l.end_ms),
        l.type,
        l.priority,
        l.status,
        l.title,
        l.detail,
      ]),
    ];
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
      )
      .join("\r\n");

    return new Response(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-cutlist.csv"`,
      },
    });
  }

  // ── Markdown ──────────────────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`# ${project.name} — cut list`);
  lines.push("");
  if (project.summary) lines.push(`_${project.summary}_`, "");
  lines.push(
    `Exported ${new Date().toLocaleString()} · ${labels.length} instruction${labels.length === 1 ? "" : "s"} · ${videos.length} clip${videos.length === 1 ? "" : "s"}`,
    "",
  );

  const briefEntries = Object.entries(briefForPrompt(brief.payload));
  if (briefEntries.length) {
    lines.push("## Brief", "");
    for (const [key, value] of briefEntries) lines.push(`- **${key}:** ${value}`);
    lines.push("");
  }

  const grouped = new Map<string, typeof labels>();
  for (const label of labels) {
    const key = label.video_id ?? "__project";
    grouped.set(key, [...(grouped.get(key) ?? []), label]);
  }

  lines.push("## Instructions", "");
  for (const [videoId, group] of grouped) {
    lines.push(
      `### ${videoId === "__project" ? "Project-wide" : (titleById.get(videoId) ?? "Unknown clip")}`,
      "",
    );
    for (const label of group) {
      const done = label.status === "done" ? "x" : " ";
      const range = label.end_ms
        ? `${timecode(label.start_ms, true)}–${timecode(label.end_ms, true)}`
        : timecode(label.start_ms, true);
      const flag = label.priority === "high" ? " **[high]**" : "";
      lines.push(
        `- [${done}] \`${range}\` **${labelStyle(label.type).label}** — ${label.title}${flag}`,
      );
      if (label.detail && label.detail !== label.title)
        lines.push(`      ${label.detail}`);
    }
    lines.push("");
  }

  if (notes.length) {
    lines.push("## Source notes", "");
    for (const note of [...notes].reverse()) {
      if (!note.text.trim()) continue;
      const clip = note.video_id ? (titleById.get(note.video_id) ?? "") : "project";
      lines.push(`> **${clip} @ ${timecode(note.anchor_ms)}** — ${note.text}`, "");
    }
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-cutlist.md"`,
    },
  });
});
