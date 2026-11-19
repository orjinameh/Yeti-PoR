import { botLog, replay, Sim, splitSegments } from "../lib/engine.ts";

// Prints JSON test vectors for the Move tests. Re-run and paste into move/tests if you change the physics.
// "segs" are the segment-relative logs exactly as they go on-chain (one submit_run call per segment).
function finalTick(seed: bigint, jumps: number[], shots: number[]): number {
  const s = new Sim(seed);
  let ji = 0, si = 0;
  while (!s.over) {
    const j = ji < jumps.length && jumps[ji] === s.tick; if (j) ji++;
    const f = si < shots.length && shots[si] === s.tick; if (f) si++;
    s.step(j, f);
  }
  return s.tick;
}
function emit(name: string, seed: bigint, jumps: number[], shots: number[]) {
  const ft = finalTick(seed, jumps, shots);
  console.log(JSON.stringify({ name, seed: seed.toString(), score: replay(seed, jumps, shots), finalTick: ft, segs: splitSegments(jumps, shots, ft) }));
}
for (const seed of [123456789n, 42n]) {
  const { jumps, shots } = botLog(seed, 3600); // plays well for 2 segments, then goes idle and is recaptured
  emit("bot", seed, jumps, shots);
}
{
  const seed = 42n; // jump-only bot: clears crates but gets hit by sentries/drones
  const s = new Sim(seed);
  const jumps: number[] = [];
  while (!s.over) {
    const j = s.tick === s.start - 1;
    if (j) jumps.push(s.tick);
    s.step(j, false);
  }
  emit("jump-only", seed, jumps, []);
}
emit("idle", 42n, [], []);
