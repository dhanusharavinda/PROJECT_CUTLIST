import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  AudioLines,
  Boxes,
  FolderSync,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
  Timer,
} from "lucide-react";
import { currentUser } from "@/lib/auth";
import { LABEL_STYLE } from "@/lib/labelStyle";
import { HelpButton } from "@/components/HelpButton";

export default async function Landing() {
  if (await currentUser()) redirect("/app");

  return (
    <div className="min-h-dvh flex flex-col">
      <TopBar />

      <main className="flex-1">
        <Hero />
        <Flow />
        <NotAnEditor />
        <Features />
        <Closer />
      </main>

      <footer className="px-6 pb-10 pt-8">
        <div className="mx-auto max-w-6xl">
          <div className="rule-x mb-6" />
          <div className="flex flex-wrap items-center justify-between gap-4 text-[12px] text-faint">
            <span>
              Cutlist, self-hosted. Your footage and your API keys stay on your
              machine.
            </span>
            <span className="tabular">v0.1</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Wordmark({ size = 17 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="relative grid place-items-center size-7 rounded-[9px] bg-signal/12 border border-signal/25">
        <span className="absolute inset-x-[7px] top-[7px] h-px bg-signal/70" />
        <span className="absolute inset-x-[5px] bottom-[8px] h-px bg-signal/35" />
        <span className="absolute left-[9px] bottom-[6px] w-px h-2.5 bg-signal" />
      </span>
      <span
        className="text-display text-chalk"
        style={{ fontSize: size, letterSpacing: "-0.015em" }}
      >
        Cutlist
      </span>
    </span>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-50 px-4 pt-4">
      <nav className="mx-auto max-w-6xl glass rounded-[14px] h-14 flex items-center justify-between gap-2 pl-3.5 pr-2 sm:pl-4 sm:pr-2.5">
        <Wordmark />
        <div className="flex items-center gap-1 shrink-0">
          <span className="sm:hidden">
            <HelpButton audience="public" compact />
          </span>
          <span className="hidden sm:block">
            <HelpButton audience="public" />
          </span>
          <Link
            href="/login"
            className="h-9 px-2.5 sm:px-3.5 inline-flex items-center rounded-[10px] text-[13.5px] whitespace-nowrap text-chalk-dim hover:text-chalk hover:bg-white/[0.055] transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="h-9 px-3 sm:px-4 inline-flex items-center gap-1.5 rounded-[10px] bg-signal text-ink-950 text-[13.5px] font-semibold whitespace-nowrap hover:bg-[#e2ff77] transition-colors"
          >
            Create<span className="hidden sm:inline"> workspace</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="px-6 pt-20 pb-16 sm:pt-28">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full glass-soft px-3 py-1.5 text-[11.5px] text-chalk-dim animate-fade">
            <span className="size-1.5 rounded-full bg-signal shadow-[0_0_8px_var(--color-signal)]" />
            Speech-to-cutlist for creator + editor teams
          </div>

          <h1
            className="text-display mt-7 text-[clamp(2.6rem,7.2vw,5.1rem)] animate-rise"
            style={{ animationDelay: "40ms" }}
          >
            Stop explaining the edit.
            <br />
            <span className="text-mute">Just </span>
            <em className="italic text-signal">talk</em>
            <span className="text-mute"> over it.</span>
          </h1>

          <p
            className="mt-6 text-[16.5px] leading-[1.62] text-chalk-dim max-w-[58ch] animate-rise"
            style={{ animationDelay: "90ms" }}
          >
            You already know the edit. Scrub your footage, hold the mic key, and
            say it out loud. Cutlist transcribes what you said, works out
            <em className="not-italic text-chalk"> which instruction it was</em>,
            pins it to the exact frame, and hands your editor a cut list instead
            of a 40-line message.
          </p>

          <div
            className="mt-9 flex flex-wrap items-center gap-3 animate-rise"
            style={{ animationDelay: "140ms" }}
          >
            <Link
              href="/signup"
              className="h-11 px-5 inline-flex items-center gap-2 rounded-[11px] bg-signal text-ink-950 text-[14.5px] font-semibold hover:bg-[#e2ff77] transition-colors shadow-[0_8px_28px_-10px_rgba(214,245,94,.7)]"
            >
              Create a workspace
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/login"
              className="h-11 px-5 inline-flex items-center rounded-[11px] border border-white/15 text-[14.5px] text-chalk-dim hover:text-chalk hover:border-white/25 hover:bg-white/[0.04] transition-colors"
            >
              I already have one
            </Link>
          </div>

          <p
            className="mt-5 text-[12.5px] text-faint animate-fade"
            style={{ animationDelay: "200ms" }}
          >
            Runs on your own machine. Bring your own transcription and AI keys:
            add them in Settings, never in a config file.
          </p>
        </div>

        <WalkthroughMock />
      </div>
    </section>
  );
}

/**
 * A real, static rendering of the walkthrough surface. Built from the same tokens as
 * the app so the landing page cannot drift from what the product looks like.
 */
function WalkthroughMock() {
  const markers = [
    { at: 8, type: "cut" as const },
    { at: 19, type: "broll" as const },
    { at: 27, type: "transition" as const },
    { at: 38, type: "text" as const },
    { at: 44, type: "zoom" as const },
    { at: 58, type: "music" as const },
    { at: 71, type: "cut" as const },
    { at: 83, type: "caption" as const },
  ];

  return (
    <div
      className="mt-16 glass rounded-[20px] p-2.5 animate-rise"
      style={{ animationDelay: "240ms" }}
    >
      <div className="rounded-[14px] bg-ink-950/55 overflow-hidden">
        {/* window chrome */}
        <div className="flex items-center gap-3 px-4 h-11 border-b border-white/[0.06]">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-white/12" />
            <span className="size-2.5 rounded-full bg-white/12" />
            <span className="size-2.5 rounded-full bg-white/12" />
          </div>
          <span className="text-[11.5px] text-faint tabular">
            ep-42-final-cut.mp4
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-faint">
            <span className="size-1.5 rounded-full bg-ok" />2 in the room
          </span>
        </div>

        <div className="grid lg:grid-cols-[1.55fr_1fr]">
          {/* reference player + marker track */}
          <div className="p-4 border-b lg:border-b-0 lg:border-r border-white/[0.06]">
            <div className="aspect-video rounded-[11px] bg-gradient-to-br from-ink-800 to-ink-950 border border-white/[0.06] grid place-items-center relative overflow-hidden">
              <div className="absolute inset-0 opacity-[0.55] bg-[radial-gradient(24rem_16rem_at_30%_20%,rgba(120,190,255,.14),transparent_60%),radial-gradient(20rem_14rem_at_78%_82%,rgba(214,245,94,.1),transparent_60%)]" />
              <span className="relative text-[11px] text-faint tabular">
                01:23.40 / 04:12.00
              </span>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-eyebrow">Markers</span>
                <span className="text-[11px] text-faint tabular">
                  8 instructions
                </span>
              </div>
              <div className="relative h-11 rounded-[9px] bg-white/[0.035] border border-white/[0.06] overflow-hidden">
                {/* waveform-ish ticks */}
                <div className="absolute inset-0 flex items-center gap-[2px] px-1.5 opacity-30">
                  {Array.from({ length: 84 }).map((_, i) => (
                    <span
                      key={i}
                      className="flex-1 rounded-full bg-white/40"
                      style={{
                        height: `${16 + Math.abs(Math.sin(i * 0.7)) * 46}%`,
                      }}
                    />
                  ))}
                </div>
                {markers.map((marker) => (
                  <span
                    key={`${marker.at}-${marker.type}`}
                    className="absolute top-0 bottom-0 w-[2px] rounded-full"
                    style={{
                      left: `${marker.at}%`,
                      background: LABEL_STYLE[marker.type].color,
                      boxShadow: `0 0 9px ${LABEL_STYLE[marker.type].color}`,
                    }}
                  />
                ))}
                <span className="absolute top-0 bottom-0 left-[33%] w-[1.5px] bg-signal shadow-[0_0_12px_var(--color-signal)]" />
              </div>
            </div>
          </div>

          {/* transcript → labels */}
          <div className="p-4 space-y-3">
            <span className="text-eyebrow">Voice note → cut list</span>

            <div className="rounded-[11px] glass-soft p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="size-1.5 rounded-full bg-danger" />
                <span className="text-[10.5px] text-faint tabular">
                  00:24 · transcribed
                </span>
              </div>
              <p className="text-[12.5px] leading-[1.6] text-chalk-dim">
                &ldquo;Okay so right here cut this whole ramble, it drags. Then
                at{" "}
                <span className="text-signal tabular">one twenty-eight</span> put
                a whoosh transition into the b-roll, and make sure the captions
                are burned in this time.&rdquo;
              </p>
            </div>

            <div className="space-y-1.5">
              {[
                { type: "cut" as const, tc: "00:24", text: "Cut the ramble, it drags" },
                {
                  type: "transition" as const,
                  tc: "01:28",
                  text: "Whoosh transition into b-roll",
                },
                {
                  type: "caption" as const,
                  tc: "All",
                  text: "Burn in captions",
                  high: true,
                },
              ].map((row) => (
                <div
                  key={row.text}
                  className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 bg-white/[0.03] border border-white/[0.055]"
                >
                  <span
                    className="size-1.5 rounded-full shrink-0"
                    style={{ background: LABEL_STYLE[row.type].color }}
                  />
                  <span className="text-[10.5px] tabular text-faint w-9 shrink-0">
                    {row.tc}
                  </span>
                  <span className="text-[12px] text-chalk-dim truncate flex-1">
                    {row.text}
                  </span>
                  {row.high ? (
                    <span className="text-[10px] text-danger shrink-0">high</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Flow() {
  const steps = [
    {
      n: "01",
      title: "Fill the brief once",
      body: "Type of edit, platform, aspect, pacing, the things you never want done again. It stops being a conversation you repeat every project, and it is what the AI reads when it judges your notes.",
    },
    {
      n: "02",
      title: "Talk over the footage",
      body: "Hold the mic, scrub, speak. Cutlist captures the playhead with the recording, so “right here” means something. Transcription runs the moment you let go.",
    },
    {
      n: "03",
      title: "The editor opens a cut list",
      body: "Not a paragraph. A timestamped, typed, prioritised list they can tick off, inside a shared room with chat, so the back-and-forth stays next to the frame it is about.",
    },
  ];

  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <span className="text-eyebrow">The handoff</span>
        <h2 className="text-display text-[clamp(1.9rem,4vw,2.9rem)] mt-3 max-w-[20ch]">
          Three steps, and the editor never asks
          <span className="text-mute"> &ldquo;which part?&rdquo;</span>
        </h2>

        <div className="mt-12 grid gap-px md:grid-cols-3 rounded-[16px] overflow-hidden border border-white/[0.07] bg-white/[0.055]">
          {steps.map((step) => (
            <div key={step.n} className="bg-ink-950/70 p-7 backdrop-blur-sm">
              <span className="text-display text-[2.4rem] text-signal/45 leading-none">
                {step.n}
              </span>
              <h3 className="text-[15px] font-semibold mt-4 text-chalk">
                {step.title}
              </h3>
              <p className="text-[13.5px] leading-[1.65] text-mute mt-2.5">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Says plainly what Cutlist is not, so nobody arrives expecting an NLE. */
function NotAnEditor() {
  return (
    <section className="px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="glass-soft rounded-[16px] px-7 py-8 sm:px-10 grid gap-7 md:grid-cols-[1.15fr_1fr] md:items-center">
          <div>
            <span className="text-eyebrow">To be clear</span>
            <p className="text-display text-[clamp(1.5rem,2.6vw,2.05rem)] mt-3 leading-[1.15]">
              Cutlist is not an editor.
            </p>
            <p className="text-[13.5px] text-mute mt-4 leading-[1.65] max-w-[52ch]">
              It never touches your media. Nothing is cut, rendered,
              transcoded or re-encoded, and no file leaves here changed. Your
              editor still cuts in Premiere, Resolve or Final Cut. Cutlist only
              carries the handoff: what to do, where it happens, and how you
              want it done.
            </p>
          </div>

          <ul className="space-y-2.5">
            {[
              ["The video", "a reference player with a marker track"],
              ["The product", "a timestamped, typed cut list"],
              ["The input", "your voice, not a form you fill twice"],
              ["The output", "Markdown, CSV or JSON your editor keeps"],
            ].map(([label, what]) => (
              <li
                key={label}
                className="flex items-baseline gap-3 border-l border-white/10 pl-3.5"
              >
                <span className="text-[11px] text-faint w-[5.5rem] shrink-0">
                  {label}
                </span>
                <span className="text-[13px] text-chalk-dim leading-snug">
                  {what}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    {
      icon: AudioLines,
      title: "Voice notes that know where they are",
      body: "Recording captures the playhead. Relative direction (“here”, “this bit”, “right before the cut”) resolves to a real frame instead of a guess.",
    },
    {
      icon: Sparkles,
      title: "Auto-labelled, not auto-summarised",
      body: "Every instruction is typed: cut, transition, filter, colour, b-roll, captions, zoom, speed, blur. Split out of compound sentences, ranked by how hard you stressed it.",
    },
    {
      icon: Timer,
      title: "“Where” becomes a click",
      body: "Markers sit on a reference scrubber in the colour of their instruction type. Click one, the player jumps there. The video is a map, never a work surface.",
    },
    {
      icon: MessagesSquare,
      title: "Questions land on the instruction",
      body: "Live chat scoped to the project, and the editor can ask on the punch-in at 1:41 itself. The creator sees “needs an answer” against that row until they reply.",
    },
    {
      icon: FolderSync,
      title: "Straight from Drive",
      body: "Connect Google Drive and pull footage in without downloading a thing. Clips stream from your own storage, under your own account.",
    },
    {
      icon: Boxes,
      title: "Second-pair-of-eyes pass",
      body: "The AI reads the brief, the transcripts and the cut list together, then tells you what you forgot, what will bite you, and what to ask before starting.",
    },
    {
      icon: ShieldCheck,
      title: "Real client isolation",
      body: "Every row is workspace-scoped and every read is workspace-filtered. Separate clients live in separate workspaces with their own members, keys and footage.",
    },
    {
      icon: Sparkles,
      title: "Your keys, your bill",
      body: "Add OpenAI, Anthropic, Deepgram, AssemblyAI, Groq, Gemini or OpenRouter keys in the app. Encrypted at rest, scoped to one workspace, never written to a file.",
    },
  ];

  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <span className="text-eyebrow">What is in it</span>
        <h2 className="text-display text-[clamp(1.9rem,4vw,2.9rem)] mt-3 max-w-[22ch]">
          Built for the two people who actually
          <span className="text-mute"> ship the video.</span>
        </h2>

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10">
          {features.map((feature) => (
            <div key={feature.title}>
              <div className="size-9 grid place-items-center rounded-[10px] glass-soft text-signal/85">
                <feature.icon size={16} strokeWidth={1.7} />
              </div>
              <h3 className="text-[14px] font-semibold mt-4 text-chalk leading-snug">
                {feature.title}
              </h3>
              <p className="text-[13px] leading-[1.62] text-mute mt-2">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closer() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="glass rounded-[20px] px-8 py-14 sm:px-14 text-center relative overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(38rem_20rem_at_50%_-10%,rgba(214,245,94,.1),transparent_65%)]" />
          <h2 className="text-display text-[clamp(2rem,4.6vw,3.2rem)] max-w-[18ch] mx-auto">
            The next 100 videos, without the handoff tax.
          </h2>
          <p className="text-[14.5px] text-mute mt-5 max-w-[52ch] mx-auto leading-relaxed">
            Set up a workspace, invite your editor, record one note over one
            clip. You will know inside five minutes whether this is faster than
            what you do now.
          </p>
          <Link
            href="/signup"
            className="mt-8 h-11 px-5 inline-flex items-center gap-2 rounded-[11px] bg-signal text-ink-950 text-[14.5px] font-semibold hover:bg-[#e2ff77] transition-colors"
          >
            Create a workspace
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}
