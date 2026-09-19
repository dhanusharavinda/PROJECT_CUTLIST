"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Copy, Download, FolderOpen, TriangleAlert } from "lucide-react";
import { Button, Modal, useToast } from "@/components/ui";
import { timecode } from "@/lib/format";
import type { ReelView } from "@/lib/reel/types";

/**
 * The handoff.
 *
 * Nothing here renders video or re-states the reel: the creator already watched
 * it. The sheet does one job, which is to say what would arrive broken, and then
 * get out of the way. Everything it lists is a problem; if the list is empty,
 * the reel is ready.
 */
export function PacketSheet({
  open,
  onClose,
  projectId,
  reel,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  reel: ReelView;
}) {
  const toast = useToast();
  const link = useRef<HTMLAnchorElement>(null);
  const [copied, setCopied] = useState(false);

  const problems = useMemo(() => {
    const found: string[] = [];

    for (const [idx, slot] of reel.slots.entries()) {
      if (slot.missing) {
        found.push(
          `Slot ${idx + 1} points at a clip that is no longer in this project. Remove it, or put the clip back.`,
        );
        continue;
      }
      if (!slot.share_url) {
        found.push(
          `Slot ${idx + 1}, ${slot.source_name}: no Drive link, so the editor gets a filename and nothing to click.`,
        );
      }
    }

    if (!reel.footage_url) {
      found.push(
        "No footage folder on this project, so the editor has no one place to open.",
      );
    }
    return found;
  }, [reel]);

  const message = useMemo(() => {
    const lines: string[] = [];
    if (reel.footage_url) lines.push(reel.footage_url);
    lines.push(
      `Shot list attached, ${reel.shots} shot${reel.shots === 1 ? "" : "s"}, ${timecode(reel.total_ms)}`,
    );
    if (reel.music_note.trim()) lines.push(`Music: ${reel.music_note.trim()}`);
    return lines.join("\n");
  }, [reel]);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Copy failed. Select the message and copy it manually.", "error");
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send to editor"
      description="One file with the order, the in and out points and your notes. The footage itself stays in Drive."
      width={560}
    >
      <div className="space-y-5">
        {problems.length > 0 ? (
          <ul className="space-y-2">
            {problems.map((problem) => (
              <li
                key={problem}
                className="flex items-start gap-2 text-[12.5px] leading-relaxed text-warn"
              >
                <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                <span>{problem}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-[12.5px] text-ok">
            <Check size={13} className="shrink-0" />
            Nothing is missing. Every slot has a clip and a link.
          </p>
        )}

        <div className="rule-x" />

        <div>
          <p className="text-eyebrow mb-1.5">Footage folder</p>
          {reel.footage_url ? (
            <a
              href={reel.footage_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-[12.5px] text-chalk-dim hover:text-chalk break-all transition-colors"
            >
              <FolderOpen size={13} className="shrink-0 text-faint" />
              {reel.footage_url}
            </a>
          ) : (
            <p className="text-[12.5px] text-mute leading-relaxed">
              Not set. It comes from the Drive folder you attached the footage
              from, on the Footage tab.
            </p>
          )}
        </div>

        <div>
          <p className="text-eyebrow mb-1.5">Message</p>
          <p className="whitespace-pre-line rounded-[10px] glass-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-chalk-dim">
            {message}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* The server names the file, so the download rides its own headers. */}
          <a
            ref={link}
            href={`/api/projects/${projectId}/export?format=packet`}
            download
            className="hidden"
            aria-hidden
            tabIndex={-1}
          />
          <Button
            variant="primary"
            icon={<Download size={14} />}
            onClick={() => link.current?.click()}
          >
            Download the shot list
          </Button>
          <Button
            icon={copied ? <Check size={14} /> : <Copy size={14} />}
            onClick={copyMessage}
          >
            {copied ? "Copied" : "Copy the message"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
