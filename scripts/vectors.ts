import { botLog, replay } from "../lib/engine.ts";
for (const seed of [123456789n, 42n]) {
  const log = botLog(seed);
  console.log(JSON.stringify({ seed: seed.toString(), score: replay(seed, log), jumps: log }));
}
console.log(JSON.stringify({ seed: "42", score: replay(42n, [1]), jumps: [1] }));
