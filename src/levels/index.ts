import type { LevelDef, LevelId } from "@/core/types";
import { backflipLevel } from "./backflip";
import { kickflipLevel } from "./kickflip";

export const LEVELS: Record<LevelId, LevelDef> = {
  backflip: backflipLevel,
  kickflip: kickflipLevel,
};

export const LEVEL_ORDER: LevelId[] = ["backflip", "kickflip"];

export function getLevel(id: LevelId): LevelDef {
  return LEVELS[id];
}

export function nextLevel(id: LevelId): LevelId {
  const i = LEVEL_ORDER.indexOf(id);
  return LEVEL_ORDER[(i + 1) % LEVEL_ORDER.length];
}
