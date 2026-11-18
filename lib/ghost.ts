import { replay, TICKS } from "./engine.ts";

export type Ghost = { seed: string; score: number; jumps: number[]; shots: number[] };

const key = (seed: bigint | string) => `yeti:best3:${seed.toString()}`;

/** Shareable text code: YG2:<seed>:<jump ticks>:<shot ticks> (comma separated) */
export function encodeGhost(seed: bigint, jumps: number[], shots: number[]): string {
  return `YG2:${seed.toString()}:${jumps.join(",")}:${shots.join(",")}`;
}

const nums = (s: string): number[] | null => {
  if (s === "") return [];
  const a = s.split(",").map(Number);
  return a.length <= TICKS && a.every((n) => Number.isInteger(n)) ? a : null;
};

/** Parses and RE-COMPUTES the score by replaying the engine, so a code can't lie about its score. */
export function parseGhost(code: string): Ghost | null {
  const m = /^YG2:(\d{1,10}):([\d,]*):([\d,]*)$/.exec(code.trim());
  if (!m) return null;
  const seed = BigInt(m[1]);
  const jumps = nums(m[2]);
  const shots = nums(m[3]);
  if (!jumps || !shots) return null;
  try {
    return { seed: seed.toString(), score: replay(seed, jumps, shots), jumps, shots };
  } catch {
    return null;
  }
}

export function loadBest(seed: bigint | string): Ghost | null {
  try {
    const raw = localStorage.getItem(key(seed));
    if (!raw) return null;
    const g = JSON.parse(raw) as Ghost;
    return Array.isArray(g.jumps) && Array.isArray(g.shots) && typeof g.score === "number" ? g : null;
  } catch {
    return null;
  }
}

/** Saves only if better than what is stored. Returns true if it became the new best. */
export function saveBest(seed: bigint | string, score: number, jumps: number[], shots: number[]): boolean {
  try {
    const cur = loadBest(seed);
    if (cur && cur.score >= score) return false;
    localStorage.setItem(key(seed), JSON.stringify({ seed: seed.toString(), score, jumps, shots }));
    return true;
  } catch {
    return false;
  }
}
