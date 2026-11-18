import { replay, TICKS } from "./engine.ts";

export type Ghost = { seed: string; score: number; jumps: number[] };

const key = (seed: bigint | string) => `yeti:best:${seed.toString()}`;

/** Shareable text code: YG1:<seed>:<comma separated jump ticks> */
export function encodeGhost(seed: bigint, jumps: number[]): string {
  return `YG1:${seed.toString()}:${jumps.join(",")}`;
}

/** Parses and RE-COMPUTES the score by replaying the engine, so a code can't lie about its score. */
export function parseGhost(code: string): Ghost | null {
  const m = /^YG1:(\d{1,10}):([\d,]*)$/.exec(code.trim());
  if (!m) return null;
  const seed = BigInt(m[1]);
  const jumps = m[2] === "" ? [] : m[2].split(",").map(Number);
  if (jumps.length > TICKS) return null;
  try {
    return { seed: seed.toString(), score: replay(seed, jumps), jumps };
  } catch {
    return null;
  }
}

export function loadBest(seed: bigint | string): Ghost | null {
  try {
    const raw = localStorage.getItem(key(seed));
    if (!raw) return null;
    const g = JSON.parse(raw) as Ghost;
    return Array.isArray(g.jumps) && typeof g.score === "number" ? g : null;
  } catch {
    return null;
  }
}

/** Saves only if better than what is stored. Returns true if it became the new best. */
export function saveBest(seed: bigint | string, score: number, jumps: number[]): boolean {
  try {
    const cur = loadBest(seed);
    if (cur && cur.score >= score) return false;
    localStorage.setItem(key(seed), JSON.stringify({ seed: seed.toString(), score, jumps }));
    return true;
  } catch {
    return false;
  }
}
