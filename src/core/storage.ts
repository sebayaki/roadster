import type { LevelId, Units } from "./types";

export interface Settings {
  muted: boolean;
  units: Units;
}

const PREFIX = "rdstr.";
const SETTINGS_KEY = "settings";
const BEST_KEY = "best";
const LEVEL_IDS: readonly LevelId[] = ["backflip", "kickflip"];

/**
 * Last known value of every key read or written. localStorage stays the source
 * of truth whenever it works (another tab may have saved a better best score);
 * this copy only answers when localStorage throws (private mode, blocked site
 * data, quota errors).
 */
const memory = new Map<string, string>();
/** Keys whose last write did not reach localStorage: their memory copy is newer. */
const unsaved = new Set<string>();

function readRaw(key: string): string | null {
  if (!unsaved.has(key)) {
    try {
      const value = window.localStorage.getItem(PREFIX + key);
      if (value === null) memory.delete(key);
      else memory.set(key, value);
      return value;
    } catch {
      // Storage unavailable: use this session's copy.
    }
  }
  return memory.get(key) ?? null;
}

function writeRaw(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(PREFIX + key, value);
    unsaved.delete(key);
  } catch {
    // Keep the in-memory copy for this session.
    unsaved.add(key);
  }
}

function readObject(key: string): Record<string, unknown> {
  const raw = readRaw(key);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Persisted settings and best scores (localStorage; falls back to memory when unavailable). */
export function loadSettings(): Settings {
  const data = readObject(SETTINGS_KEY);
  return {
    muted: data.muted === true,
    units: data.units === "imperial" ? "imperial" : "metric",
  };
}

export function saveSettings(settings: Settings): void {
  writeRaw(
    SETTINGS_KEY,
    JSON.stringify({ muted: settings.muted, units: settings.units })
  );
}

export function loadBestScores(): Partial<Record<LevelId, number>> {
  const data = readObject(BEST_KEY);
  const best: Partial<Record<LevelId, number>> = {};
  for (const id of LEVEL_IDS) {
    const value = data[id];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      best[id] = Math.round(value);
    }
  }
  return best;
}

/** Returns true when `score` beats the stored best (and stores it). */
export function submitScore(level: LevelId, score: number): boolean {
  if (!Number.isFinite(score)) return false;
  const best = loadBestScores();
  const rounded = Math.round(score);
  if (rounded <= (best[level] ?? 0)) return false;
  best[level] = rounded;
  writeRaw(BEST_KEY, JSON.stringify(best));
  return true;
}
