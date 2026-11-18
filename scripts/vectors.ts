import { botLog, replay, Sim } from "../lib/engine.ts";

// Prints JSON test vectors for the Move tests. Re-run and paste into move/tests if you change the physics.
for (const seed of [123456789n, 42n]) {
  const { jumps, shots } = botLog(seed);
  console.log(JSON.stringify({ name: "bot", seed: seed.toString(), score: replay(seed, jumps, shots), jumps, shots }));
}
// jump-only bot: clears crates but gets hit by sentries/drones
{
  const seed = 42n;
  const s = new Sim(seed);
  const jumps: number[] = [];
  while (!s.over) {
    const j = s.tick === s.start - 1;
    if (j) jumps.push(s.tick);
    s.step(j, false);
  }
  console.log(JSON.stringify({ name: "jump-only", seed: "42", score: replay(seed, jumps, []), jumps, shots: [] }));
}
// idle: no input at all
console.log(JSON.stringify({ name: "idle", seed: "42", score: replay(42n, [], []), jumps: [], shots: [] }));
