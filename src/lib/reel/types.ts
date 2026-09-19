/**
 * The reel, as data.
 *
 * Nothing in here is video. A slot says which clip plays, which part of it, and
 * where that lands in the finished reel; the editor takes those numbers, the
 * Drive filename and the note, and does the cutting themselves.
 */

/** How the in and out points were arrived at. Advisory, never enforced. */
export type SlotSnap = "manual" | "shot" | "beat";

export interface ReelSlot {
  id: string;
  workspace_id: string;
  project_id: string;
  video_id: string;
  idx: number;
  in_ms: number;
  out_ms: number;
  note: string;
  snap: SlotSnap;
  created_at: number;
  updated_at: number;
}

/** A slot with everything the creator and the packet need beside it. */
export interface ReelSlotView extends ReelSlot {
  /** The app title, null once the clip row has gone. */
  title: string | null;
  /** The Drive filename: what the editor actually searches for. */
  source_name: string;
  share_url: string | null;
  duration_ms: number;
  /** How long this slot holds: out_ms - in_ms. */
  hold_ms: number;
  /** Where the slot starts inside the finished reel. */
  reel_start_ms: number;
  /** Nearest analysis frame to the in point, for a poster. */
  frame_idx: number | null;
  /** The clip is gone. The slot stays, so the creator can see the hole. */
  missing: boolean;
}

export interface ReelView {
  slots: ReelSlotView[];
  total_ms: number;
  shots: number;
  median_hold_ms: number;
  /** The niche's sensible hold for one shot, to measure the reel against. */
  target_ms: [number, number];
  footage_url: string | null;
  music_note: string;
  packet_rev: number;
}

/** What a client sends. The order of the array is the order of the reel. */
export interface SlotInput {
  videoId: string;
  inMs: number;
  outMs: number;
  note?: string;
  snap?: SlotSnap;
}
