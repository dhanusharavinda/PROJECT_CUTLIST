import { route } from "@/lib/api";
import { badRequest, requireCtx } from "@/lib/tenancy";
import { timecode } from "@/lib/format";
import { labelStyle } from "@/lib/labelStyle";
import { buildPacket, packetRefusals } from "@/lib/reel/packet";
import { buildEditGraph, compactGraph } from "@/lib/graph/build";
import { renderPacket } from "@/lib/reel/render";

type Params = { params: Promise<{ projectId: string }> };

export const dynamic = "force-dynamic";

/**
 * The cut list, out of the app.
 *
 * `packet` is the one that matters: a single self-contained HTML file for the
 * editor, with the stills inlined. The rest are for the creator's own use:
 * markdown for pasting into notes, CSV for a spreadsheet, JSON for scripting,
 * EDL for laying the reel out in Resolve or Premiere.
 *
 * Every format reads one `buildPacket` result, so none of them can disagree
 * about the order of the reel or about which instruction belongs where.
 */
export const GET = route(async (req, { params }: Params) => {
  const ctx = await requireCtx();
  const { projectId } = await params;

  const format = (new URL(req.url).searchParams.get("format") || "md").toLowerCase();
  // Stills cost one ffmpeg seek each, and only the packet prints them.
  const packet = await buildPacket(ctx, projectId, { stills: format === "packet" });
  const { project, videos, labels, notes, titleById } = packet.source;
  const slug = packet.slug;

  // ── The AI project package ───────────────────────────────────────────────
  //
  // Structured context for an outside agent: brief, template, transcript,
  // shots, frames as URLs, instructions, recommendations, guardrails, the reel
  // and the version history. Never the video itself.
  if (format === "package") {
    const graph = compactGraph(buildEditGraph(ctx, projectId));
    return new Response(
      JSON.stringify({ format: "cutlist-ai-package", schema: 1, ...graph }, null, 2),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${slug}-ai-package.json"`,
        },
      },
    );
  }

  // ── The packet ────────────────────────────────────────────────────────────
  //
  // Refused rather than written when any of it would point at footage the
  // editor cannot open. They have no login and no way to ask mid-job, so a
  // dead reference costs them an afternoon.
  if (format === "packet") {
    const reasons = packetRefusals(packet);
    if (reasons.length) {
      throw badRequest(
        `The packet would send your editor somewhere they cannot go. ${reasons.join(" ")}`,
      );
    }

    return new Response(renderPacket(packet), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-packet-v${packet.packet_rev}.html"`,
      },
    });
  }

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
          brief: packet.brief.prompt,
          videos: videos.map((v) => ({
            id: v.id,
            title: v.title,
            duration_ms: v.duration_ms,
            source: v.source,
          })),
          reel: packet.slots.map((slot) => ({
            idx: slot.number,
            file: slot.source_name,
            in_ms: slot.in_ms,
            out_ms: slot.out_ms,
            hold_ms: slot.hold_ms,
            reel_start_ms: slot.reel_start_ms,
            share_url: slot.link_url,
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

  // ── EDL, for DaVinci Resolve and Premiere ─────────────────────────────────
  //
  // With a reel, each slot is its own event: the source in and out are the
  // slot's, and the record in runs forward from the slot's offset, so the
  // timeline that lands in the NLE is the order the creator chose. Without a
  // reel there is nothing to lay out, so the old behaviour stands: markers
  // stacked against a zero start for someone to drag onto their own cut.
  if (format === "edl") {
    const colour: Record<string, string> = {
      cut: "ResolveColorRed",
      trim: "ResolveColorRed",
      transition: "ResolveColorBlue",
      filter: "ResolveColorPurple",
      color: "ResolveColorPurple",
      text: "ResolveColorYellow",
      caption: "ResolveColorYellow",
      broll: "ResolveColorGreen",
      sfx: "ResolveColorPink",
      music: "ResolveColorPink",
      zoom: "ResolveColorCyan",
      speed: "ResolveColorCyan",
      blur: "ResolveColorCream",
      keep: "ResolveColorMint",
      note: "ResolveColorBlue",
    };

    // One frame rate per EDL. Two rates in one file means every timecode after
    // the first mismatch is wrong by a growing amount, and nothing in the file
    // says so, which is the worst way for an export to fail.
    if (packet.frame_rates.length > 1) {
      throw badRequest(
        `This reel mixes frame rates (${packet.frame_rates.join(" fps, ")} fps). An EDL carries one rate, so the timecodes would drift further with every cut. Export the packet, or re-export the odd clips at one rate first.`,
      );
    }

    const fps = Math.max(1, Math.round(packet.frame_rates[0] || 30));
    const tc = (ms: number) => {
      const total = Math.max(0, Math.round((ms / 1000) * fps));
      const pad = (n: number) => String(n).padStart(2, "0");
      return [
        pad(Math.floor(total / (fps * 3600))),
        pad(Math.floor(total / (fps * 60)) % 60),
        pad(Math.floor(total / fps) % 60),
        pad(total % fps),
      ].join(":");
    };
    const clean = (value: string) => value.replace(/[|\r\n]+/g, " ").trim();
    const event = (index: number, srcIn: string, srcOut: string, recIn: string, recOut: string) =>
      `${String(index).padStart(3, "0")}  AX       V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`;

    const out: string[] = [
      `TITLE: ${project.name.toUpperCase().slice(0, 60)} ${packet.slots.length ? `REEL V${packet.packet_rev}` : "CUTLIST"}`,
      "FCM: NON-DROP FRAME",
      "",
    ];

    if (packet.slots.length) {
      for (const chip of packet.whole_reel) {
        out.push(`* WHOLE REEL: ${clean(`${chip.type_label}: ${chip.title}`)}`);
      }
      if (packet.whole_reel.length) out.push("");

      // Record time runs forward across the reel; a gap in the slot offsets
      // would put black between two cuts, so the running total wins.
      let recordMs = 0;
      packet.slots.forEach((slot, index) => {
        const recIn = tc(recordMs);
        const recOut = tc(recordMs + slot.hold_ms);
        out.push(
          event(index + 1, tc(slot.in_ms), tc(slot.out_ms), recIn, recOut),
          `* FROM CLIP NAME: ${clean(slot.source_name) || "MISSING CLIP"}`,
        );
        if (slot.note) out.push(`* COMMENT: ${clean(slot.note)}`);
        for (const chip of slot.instructions) {
          const at = chip.at ? `${chip.at} ` : "";
          out.push(
            ` |C:${colour[chip.type] ?? "ResolveColorBlue"} |M:${clean(`${at}${chip.type_label}: ${chip.title}`).slice(0, 90)} |D:1`,
          );
        }
        out.push("");
        recordMs += slot.hold_ms;
      });
    } else {
      labels.forEach((label, index) => {
        const start = tc(label.start_ms);
        const end = tc(label.end_ms ?? label.start_ms + Math.round(1000 / fps));
        out.push(
          event(index + 1, start, end, start, end),
          ` |C:${colour[label.type] ?? "ResolveColorBlue"} |M:${clean(labelStyle(label.type).label + ": " + label.title).slice(0, 90)} |D:1`,
          `* FROM CLIP NAME: ${clean(label.video_id ? (titleById.get(label.video_id) ?? "clip") : project.name)}`,
          "",
        );
      });
    }

    return new Response(out.join("\r\n"), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-markers.edl"`,
      },
    });
  }

  // ── Markdown ──────────────────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`# ${project.name}: cut list`);
  lines.push("");
  if (project.summary) lines.push(`_${project.summary}_`, "");
  lines.push(
    `Exported ${new Date().toLocaleString()} · ${labels.length} instruction${labels.length === 1 ? "" : "s"} · ${videos.length} clip${videos.length === 1 ? "" : "s"}`,
    "",
  );

  if (packet.brief.pairs.length) {
    lines.push("## Brief", "");
    for (const pair of packet.brief.pairs) lines.push(`- **${pair.label}:** ${pair.value}`);
    lines.push("");
  }

  const bullet = (chip: { done: boolean; at: string; type_label: string; title: string; detail: string; priority: string }) => {
    const done = chip.done ? "x" : " ";
    const flag = chip.priority === "high" ? " **[high]**" : "";
    const at = chip.at ? `\`${chip.at}\` ` : "";
    const rows = [`- [${done}] ${at}**${chip.type_label}**: ${chip.title}${flag}`];
    if (chip.detail) rows.push(`      ${chip.detail}`);
    return rows;
  };

  if (packet.slots.length) {
    // Slot order, not timestamp order. Grouping by whichever clip happens to
    // hold the earliest instruction contradicts the order the creator chose,
    // which is the one thing this document exists to carry.
    if (packet.whole_reel.length) {
      lines.push("## Applies to the whole reel", "");
      for (const chip of packet.whole_reel) lines.push(...bullet(chip));
      lines.push("");
    }

    lines.push("## The cut, in order", "");
    for (const slot of packet.slots) {
      lines.push(`### ${slot.number}. ${slot.source_name}`, "");
      lines.push(`${slot.range_label}, at ${slot.reel_start_tc} in the reel`, "");
      if (slot.note) lines.push(`> ${slot.note}`, "");
      if (slot.instructions.length) {
        for (const chip of slot.instructions) lines.push(...bullet(chip));
      } else {
        lines.push("- No instructions on this shot.");
      }
      lines.push("");
    }

    if (packet.orphans.length) {
      lines.push("## Also said, but not inside a slot", "");
      for (const chip of packet.orphans) {
        lines.push(...bullet({ ...chip, title: `${chip.clip}: ${chip.title}` }));
      }
      lines.push("");
    }

    if (packet.counts.skipped) {
      lines.push(
        `${packet.counts.skipped} cancelled instruction${packet.counts.skipped === 1 ? "" : "s"} left out.`,
        "",
      );
    }
  } else {
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
          ? `${timecode(label.start_ms, true)} to ${timecode(label.end_ms, true)}`
          : timecode(label.start_ms, true);
        const flag = label.priority === "high" ? " **[high]**" : "";
        lines.push(
          `- [${done}] \`${range}\` **${labelStyle(label.type).label}**: ${label.title}${flag}`,
        );
        if (label.detail && label.detail !== label.title)
          lines.push(`      ${label.detail}`);
      }
      lines.push("");
    }
  }

  if (notes.length) {
    lines.push("## Source notes", "");
    for (const note of [...notes].reverse()) {
      if (!note.text.trim()) continue;
      const clip = note.video_id ? (titleById.get(note.video_id) ?? "") : "project";
      lines.push(`> **${clip} @ ${timecode(note.anchor_ms)}**: ${note.text}`, "");
    }
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-cutlist.md"`,
    },
  });
});
