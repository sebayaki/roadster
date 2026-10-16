import type { LevelId } from "@/core/types";
import type { AutopilotStyle } from "@/physics/autopilot";

export interface DemoEntry {
  level: LevelId;
  style: AutopilotStyle;
}

/** The attract demo alternates stunts and styles. */
const PLAYLIST: readonly DemoEntry[] = [
  { level: "backflip", style: "clean" },
  { level: "kickflip", style: "clean" },
  { level: "backflip", style: "double" },
  { level: "kickflip", style: "double" },
];

/** Seconds to linger after the stunt settles before cutting to the next one. */
const HOLD = 2.2;
/** Moves on even if a stunt never settles (e.g. it rolled back down the ramp). */
const TIMEOUT = 40;

/** Playlist and timing of the silent autopilot demo behind the menu. */
export class AttractDemo {
  private index = 0;
  private elapsed = 0;
  private holdLeft = -1;

  get entry(): DemoEntry {
    return PLAYLIST[this.index];
  }

  /** Restart the timers for the current entry. */
  restart(): void {
    this.elapsed = 0;
    this.holdLeft = -1;
  }

  /** The stunt finished; cut to the next one after a short hold. */
  settled(): void {
    if (this.holdLeft < 0) this.holdLeft = HOLD;
  }

  /** Advance the timers; true when it is time to cut to the next entry. */
  update(dt: number): boolean {
    this.elapsed += dt;
    if (this.holdLeft >= 0) {
      this.holdLeft -= dt;
      if (this.holdLeft <= 0) return true;
    }
    return this.elapsed > TIMEOUT;
  }

  next(): void {
    this.index = (this.index + 1) % PLAYLIST.length;
    this.restart();
  }
}
