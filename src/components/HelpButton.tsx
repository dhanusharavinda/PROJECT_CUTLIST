"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowRight, CircleHelp } from "lucide-react";
import { Modal, Segmented } from "@/components/ui";

/**
 * The one place a lost user can ask "where is it, and how do I get there".
 * Every answer that has a destination carries a link to it.
 */

export type HelpTopic = "start" | "navigate" | "notes" | "shortcuts" | "access" | "how";

type Audience = "app" | "public";

interface Step {
  title: string;
  body: string;
  href?: string;
  cta?: string;
}

const TOPICS: Record<Audience, { value: HelpTopic; label: string }[]> = {
  app: [
    { value: "start", label: "Start here" },
    { value: "navigate", label: "Find your way" },
    { value: "notes", label: "Voice notes" },
    { value: "shortcuts", label: "Shortcuts" },
  ],
  public: [
    { value: "access", label: "Get access" },
    { value: "how", label: "How it works" },
  ],
};

const START: Step[] = [
  {
    title: "Create a project",
    body: "One project holds one video, or a batch of them. Start from Overview with New project.",
    href: "/app",
    cta: "Go to Overview",
  },
  {
    title: "Fill in the brief",
    body: "Open the project and use the Brief tab: edit type, platform, pacing, and what must never happen. The AI reads it when it labels your notes.",
  },
  {
    title: "Save your settings as a template",
    body: "At the top of the Brief tab, Save as template keeps the style and rules under a name. The next project can start from it, or you can apply it to a half-written brief. Editing a template later makes a new version and leaves existing projects alone.",
    href: "/app/templates",
    cta: "Open Templates",
  },
  {
    title: "Add footage",
    body: "Footage tab. Upload a file, paste a direct link, or pick a clip from Google Drive.",
  },
  {
    title: "Analyse the footage",
    body: "Plan tab, then Analyse footage. It runs on your machine with no API key: every cut, how much each shot moves, its colour, the tempo and beat grid of the music, and every silence.",
  },
  {
    title: "Generate an edit plan",
    body: "Still in the Plan tab. Pick what you are making (gym edit, aesthetic reel, surreal, mini vlog) and Cutlist suggests what to open on, what to tighten, where to land on the beat, and what to put on screen. Tick the ones you want into the cut list.",
  },
  {
    title: "Run the creative director",
    body: "Plan tab, top panel. It reads the brief, the rules, every shot and what you already decided, then proposes. Approve, change or reject each suggestion; only what you convert reaches the cut list. Type a sentence like \"faster middle, leave the hook alone\" to revise just that part.",
  },
  {
    title: "Talk over the clip",
    body: "Press Open walkthrough, park the playhead where you want a change, press R and say it out loud. The note is pinned to that exact moment.",
  },
  {
    title: "Hand off the cut list",
    body: "The Cut list tab turns notes into typed, timestamped instructions. Your editor ticks them off and asks questions on a specific row.",
  },
  {
    title: "Or let an AI agent read it",
    body: "History tab, bottom panel. Make a token, paste it and the MCP URL into ChatGPT or Astra, and the agent can read everything about the project but change nothing. Export the AI project package from the same tab for tools that take a file.",
  },
  {
    title: "Invite your editor",
    body: "Settings, then People. Create an invite and send the one-time link yourself.",
    href: "/app/settings",
    cta: "Open Settings",
  },
  {
    title: "Turn on AI (optional)",
    body: "Settings, then AI providers. Paste a speech-to-text key and a language-model key. Without keys, notes still save and keyword rules do the labelling.",
    href: "/app/settings",
    cta: "Add keys",
  },
];

const PLACES: { name: string; where: string; body: string; href?: string }[] = [
  {
    name: "Overview",
    where: "Sidebar, top",
    body: "Every project in this workspace, open instructions, and whether AI keys are connected.",
    href: "/app",
  },
  {
    name: "Projects",
    where: "Sidebar, under Projects",
    body: "Jump straight into any project. The number beside it is how many instructions are still open.",
  },
  {
    name: "Brief, Footage, Cut list, Review",
    where: "Tabs inside a project",
    body: "Brief is what the creator wants. Footage holds the clips. Cut list is the editor's to-do list. Review asks the AI what you missed.",
  },
  {
    name: "Plan",
    where: "Tab inside a project",
    body: "Footage analysis and the suggested edit. Also where you mark a reel as a reference, so its pacing becomes the target for the plan.",
  },
  {
    name: "Templates",
    where: "Sidebar",
    body: "The settings your edits share, saved from a project's brief: platform, pacing, style, rules. Start a project from one, or apply one to a brief. Never footage.",
    href: "/app/templates",
  },
  {
    name: "Clip library",
    where: "Sidebar",
    body: "Every clip across every project, tagged by what was measured in it: 9:16, golden hour, locked off, music, talking. Search it when you need a shot rather than a project.",
    href: "/app/library",
  },
  {
    name: "Room",
    where: "Right side of a project",
    body: "Live chat for the project. A question pinned to an instruction shows up on that row.",
  },
  {
    name: "Walkthrough",
    where: "Open walkthrough, or a clip in Footage",
    body: "The player, marker track, recorder and notes for one clip. Clicking a timestamp in the cut list also opens it at that moment.",
  },
  {
    name: "Export",
    where: "Project header",
    body: "Download the cut list as Markdown, CSV, JSON, or an EDL of markers for DaVinci Resolve and Premiere.",
  },
  {
    name: "Settings",
    where: "Sidebar",
    body: "AI providers, Google Drive, People, and solo mode for when you edit your own videos and want the chat room out of the way.",
    href: "/app/settings",
  },
  {
    name: "Workspaces",
    where: "Sidebar, top",
    body: "Switch between clients or create a new workspace. Nothing is shared between them.",
  },
  {
    name: "Sign out",
    where: "Sidebar, bottom",
    body: "The exit icon next to your name.",
  },
];

const NOTE_TIPS = [
  "Click a note's text or its timestamp and the player jumps to the moment it was recorded.",
  "Press play on a note to hear the original recording. The video pauses and moves to that moment first. Press again to stop.",
  "Open timed segments and click a line to hear just that part of the recording.",
  "On the marker track, dots are notes and coloured bars are instructions. Click a dot to open its note.",
  "The chips under a note are the instructions it produced. Click one to jump to where it applies.",
  "Wrong transcript? Use the pencil to fix it. Cutlist re-labels it without transcribing again.",
  "To record: park the playhead, press R (or the mic button), talk, then press R again.",
  "Instructions float over the picture only while they apply, one at a time. Press I to hide them, O for the detail, G for Instagram's safe areas.",
];

const SHORTCUTS: [string, string][] = [
  ["Space or K", "Play or pause"],
  ["J / L", "Back or forward 10 seconds"],
  ["Left / Right", "Back or forward 5 seconds"],
  [", / .", "Step one frame"],
  ["R", "Start or stop recording"],
  ["M", "Mute"],
  ["F", "Fullscreen"],
  ["I", "Hide or show the floating instructions"],
  ["O", "Fold out the detail of the current one"],
  ["G", "Show Instagram's safe areas"],
  ["?", "Open this guide"],
];

const ACCESS: Step[] = [
  {
    title: "New here? Create a workspace",
    body: "Sign up with your name, email and a password. You become the owner of a fresh workspace.",
    href: "/signup",
    cta: "Create a workspace",
  },
  {
    title: "Already have an account? Sign in",
    body: "Use the email and password you signed up with.",
    href: "/login",
    cta: "Sign in",
  },
  {
    title: "Invited by a creator or editor?",
    body: "Open the invite link they sent you. Sign in or sign up from that page and you land in their workspace with the role they chose. Each link works once. If sign-up is turned off on this server, an invite is the only way in.",
  },
  {
    title: "Add AI whenever you like",
    body: "Once inside, go to Settings, then AI providers, to paste transcription and language-model keys. Nothing is needed just to look around.",
  },
];

const HOW: Step[] = [
  {
    title: "Write the brief",
    body: "Say what kind of edit this is once: platform, pacing, tone, and what must never happen.",
  },
  {
    title: "Talk over your footage",
    body: "Scrub to a moment, hit record, say what you want. The note is pinned to that frame.",
  },
  {
    title: "Get a cut list",
    body: "Cutlist transcribes the note and splits it into typed, timestamped instructions.",
  },
  {
    title: "Hand it off",
    body: "Your editor works the list, asks questions on a row, and ticks items off. Cutlist never edits the video itself.",
  },
];

export function HelpButton({
  audience = "app",
  initialTopic,
  compact = false,
  className,
}: {
  audience?: Audience;
  /** Which tab opens first, e.g. "notes" on the walkthrough. */
  initialTopic?: HelpTopic;
  /** Icon only, for tight bars. */
  compact?: boolean;
  className?: string;
}) {
  const topics = TOPICS[audience];
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<HelpTopic>(topics[0].value);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const show = useCallback(() => {
    setTopic(
      initialTopic && topics.some((t) => t.value === initialTopic)
        ? initialTopic
        : topics[0].value,
    );
    setOpen(true);
  }, [initialTopic, topics]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "?" || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      )
        return;
      // Several triggers can be mounted at once (mobile bar, desktop header).
      // Only one that is actually on screen answers, and only the first.
      if (!trigger.current || trigger.current.getClientRects().length === 0) return;
      event.preventDefault();
      show();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        aria-label={compact ? "Help" : undefined}
        title="Help (press ?)"
        className={clsx(
          "h-9 inline-flex items-center justify-center gap-1.5 rounded-[10px] text-[13px] text-chalk-dim hover:text-chalk hover:bg-white/[0.055] transition-colors shrink-0",
          compact ? "w-9" : "px-2.5",
          className,
        )}
      >
        <CircleHelp size={compact ? 17 : 15} aria-hidden />
        {compact ? null : "Help"}
      </button>

      <Modal
        open={open}
        onClose={close}
        title={audience === "app" ? "Help and guide" : "Getting into Cutlist"}
        description={
          audience === "app"
            ? "Where things are, how to get there, and what to do first."
            : "How to sign in, join a workspace, and what happens next."
        }
        width={600}
      >
        <div className="overflow-x-auto no-scrollbar">
          <Segmented<HelpTopic> value={topic} onChange={setTopic} options={topics} />
        </div>

        <div className="mt-5">
          {topic === "start" ? <Steps steps={START} onNavigate={close} /> : null}
          {topic === "navigate" ? <Places onNavigate={close} /> : null}
          {topic === "notes" ? <Tips tips={NOTE_TIPS} /> : null}
          {topic === "shortcuts" ? <Shortcuts /> : null}
          {topic === "access" ? (
            <>
              <Steps steps={ACCESS} onNavigate={close} />
              <DemoAccounts />
            </>
          ) : null}
          {topic === "how" ? <Steps steps={HOW} onNavigate={close} /> : null}
        </div>

        <p className="mt-6 text-[11.5px] text-faint">
          Press <Kbd>?</Kbd> anywhere to open this guide again.
        </p>
      </Modal>
    </>
  );
}

function Steps({ steps, onNavigate }: { steps: Step[]; onNavigate: () => void }) {
  return (
    <ol className="space-y-4">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3">
          <span className="mt-px size-6 shrink-0 grid place-items-center rounded-full border border-signal/30 bg-signal/10 text-[11px] tabular text-signal">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] text-chalk">{step.title}</p>
            <p className="text-[12.5px] text-mute leading-relaxed mt-0.5">{step.body}</p>
            {step.href ? (
              <Link
                href={step.href}
                onClick={onNavigate}
                className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-signal hover:underline underline-offset-2"
              >
                {step.cta ?? "Open"}
                <ArrowRight size={12} aria-hidden />
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Places({ onNavigate }: { onNavigate: () => void }) {
  return (
    <>
      <ul className="divide-y divide-white/[0.06]">
        {PLACES.map((place) => (
          <li key={place.name} className="py-3 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-[13.5px] text-chalk">{place.name}</p>
              <span className="text-[11px] text-faint">{place.where}</span>
            </div>
            <p className="text-[12.5px] text-mute leading-relaxed mt-0.5">{place.body}</p>
            {place.href ? (
              <Link
                href={place.href}
                onClick={onNavigate}
                className="mt-1 inline-flex items-center gap-1 text-[12px] text-signal hover:underline underline-offset-2"
              >
                Go there
                <ArrowRight size={12} aria-hidden />
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-faint leading-relaxed">
        On a phone, the sidebar is behind the menu button in the top left.
      </p>
    </>
  );
}

function Tips({ tips }: { tips: string[] }) {
  return (
    <ul className="space-y-2.5">
      {tips.map((tip) => (
        <li key={tip} className="flex gap-2.5 text-[12.5px] text-chalk-dim leading-relaxed">
          <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-signal/70" aria-hidden />
          {tip}
        </li>
      ))}
    </ul>
  );
}

function Shortcuts() {
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 items-center">
        {SHORTCUTS.map(([keys, action]) => (
          <div key={keys} className="contents">
            <dt>
              <Kbd>{keys}</Kbd>
            </dt>
            <dd className="text-[12.5px] text-chalk-dim">{action}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[12px] text-faint leading-relaxed">
        Player shortcuts work on the walkthrough page and are ignored while you type in a field.
      </p>
    </>
  );
}

function DemoAccounts() {
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div className="mt-5 rounded-[12px] border border-white/[0.08] bg-white/[0.03] px-4 py-3">
      <p className="text-[12.5px] text-chalk">Local demo accounts</p>
      <p className="text-[12px] text-mute mt-1 leading-relaxed">
        These exist only after <code className="text-chalk-dim">npm run seed</code>. Password for
        both: <code className="text-chalk-dim">cutlist123</code>
      </p>
      <ul className="mt-2 space-y-1 text-[12px]">
        <li>
          <span className="text-chalk-dim">ada@cutlist.local</span>{" "}
          <span className="text-faint">creator and owner</span>
        </li>
        <li>
          <span className="text-chalk-dim">theo@cutlist.local</span>{" "}
          <span className="text-faint">editor</span>
        </li>
      </ul>
      <p className="text-[11px] text-faint mt-2">Shown in development only.</p>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block rounded border border-white/12 bg-white/[0.04] px-1.5 py-px text-[11px] tabular text-chalk-dim whitespace-nowrap">
      {children}
    </kbd>
  );
}
