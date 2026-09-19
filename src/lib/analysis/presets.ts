import type { NicheId } from "./types";

/**
 * What "good" means, per kind of reel.
 *
 * These numbers drive the local planner and are handed to the model as targets
 * so its advice and the offline advice never contradict each other.
 */
export interface Niche {
  id: NicheId;
  label: string;
  blurb: string;
  /** Sensible hold time for one shot, in ms. */
  shot_ms: [number, number];
  /** Sensible total length for the finished reel, in ms. */
  length_ms: [number, number];
  cut_on_beat: boolean;
  wants_captions: boolean;
  overlays: string[];
  hashtags: string[];
  guidance: string;
}

export const NICHES: Niche[] = [
  {
    id: "gym",
    label: "Gym edit",
    blurb: "Beat-driven lifting clips. Cuts on the beat, slow motion on the peak rep.",
    shot_ms: [700, 2200],
    length_ms: [12_000, 35_000],
    cut_on_beat: true,
    wants_captions: false,
    overlays: [
      "Weight and reps on the first working set",
      "Exercise name as the shot opens",
      "Week or PR counter in a corner",
    ],
    hashtags: ["gym", "gymmotivation", "fitness", "workout", "progress"],
    guidance:
      "This is a gym edit. Cuts land on the beat. The peak of a rep is the moment to slow down or ramp. Drops in the music want a hard cut, a flash or an impact sound. Keep the lifter's face or the bar in frame. Avoid long static shots and avoid cutting mid-rep.",
  },
  {
    id: "aesthetic",
    label: "Aesthetic reel",
    blurb: "Short holds, matched colour, a consistent look across every shot.",
    shot_ms: [500, 1500],
    length_ms: [8000, 25_000],
    cut_on_beat: true,
    wants_captions: false,
    overlays: [
      "One short line of text in the first second",
      "A place or time stamp in a small corner font",
    ],
    hashtags: ["aesthetic", "reels", "cinematic", "moodboard", "filmphotography"],
    guidance:
      "This is an aesthetic reel. The look has to be consistent: flag shots whose colour or exposure breaks from the rest. Mix wide, medium and detail shots rather than repeating one framing. Hold each shot briefly. Match cuts on colour or shape are worth more than a transition effect.",
  },
  {
    id: "surreal",
    label: "Surreal edit",
    blurb: "Effect-led. Finds the locked-off shots that masking and freezes need.",
    shot_ms: [800, 3000],
    length_ms: [10_000, 30_000],
    cut_on_beat: false,
    wants_captions: false,
    overlays: [
      "A single line that sets up the illusion",
      "No text over the effect itself",
    ],
    hashtags: ["surreal", "vfx", "aftereffects", "editing", "visualart"],
    guidance:
      "This is a surreal edit built on effects. The useful shots are the locked-off ones with a clean background and a clear subject, because masking, cloning and freeze frames need them. Point out which shots can carry an effect and which cannot. Suggest match cuts between shots with similar composition. Never suggest an effect that needs footage the creator does not have.",
  },
  {
    id: "vlog",
    label: "Mini vlog",
    blurb: "Talking plus B-roll. Kills dead air and finds the hook sentence.",
    shot_ms: [2000, 5000],
    length_ms: [30_000, 90_000],
    cut_on_beat: false,
    wants_captions: true,
    overlays: [
      "The hook line burned in over the first shot",
      "Chapter or time-of-day markers",
    ],
    hashtags: ["vlog", "dayinmylife", "minivlog", "lifestyle", "routine"],
    guidance:
      "This is a mini vlog. The hook is the first sentence, so say which line should open it. Dead air, filler words and rambling get cut. Any stretch of talking head longer than about three seconds needs B-roll over it. Captions are burned in. Keep the story shape: setup, moment, payoff.",
  },
  {
    id: "general",
    label: "General",
    blurb: "No preset. Balanced pacing advice only.",
    shot_ms: [1000, 3000],
    length_ms: [15_000, 60_000],
    cut_on_beat: false,
    wants_captions: true,
    overlays: ["A short title in the first second"],
    hashtags: ["reels", "edit", "contentcreator"],
    guidance:
      "No niche was chosen. Give balanced advice: a strong opening, varied shots, no dead air, and captions if there is speech.",
  },
];

export function niche(id: string | null | undefined): Niche {
  return NICHES.find((n) => n.id === id) ?? NICHES[NICHES.length - 1];
}

export const NICHE_IDS: NicheId[] = NICHES.map((n) => n.id);

/** Instagram's own UI covers these parts of a 9:16 frame. */
export const SAFE_ZONE = [
  "Bottom ~20%: the caption, handle and audio strip sit here. Keep text and faces above it.",
  "Right ~15%: like, comment, share and the audio disc. Nothing important on that edge.",
  "Top ~10%: the status bar and the Reels label overlap here.",
];
