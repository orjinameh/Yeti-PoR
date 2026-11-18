// Deterministic fixed-point runner engine. MUST stay identical to move/sources/proof_of_run.move.
export const TICKS = 600;
export const TPS = 10;
export const PROFILE = [9, 16, 22, 27, 30, 31, 31, 30, 27, 22, 16, 9];
const M = 2147483648n;

export class Sim {
  rng: bigint;
  start: number; // first tick of next obstacle (spans start..start+2)
  tick = 0;
  air = 0;
  passed = 0;
  dead = false;
  constructor(seed: bigint) {
    this.rng = seed % M;
    this.start = 20 + this.draw();
  }
  private draw(): number {
    this.rng = (this.rng * 1103515245n + 12345n) % M;
    return Number((this.rng >> 16n) % 10n);
  }
  height(): number {
    return this.air === 0 ? 0 : PROFILE[this.air - 1];
  }
  get over(): boolean {
    return this.dead || this.tick >= TICKS;
  }
  get score(): number {
    return this.passed * 100 + this.tick;
  }
  /** upcoming obstacle start ticks (does not mutate state) */
  upcoming(n: number): number[] {
    const out = [this.start];
    let r = this.rng;
    let s = this.start;
    while (out.length < n) {
      r = (r * 1103515245n + 12345n) % M;
      s = s + 16 + Number((r >> 16n) % 10n);
      out.push(s);
    }
    return out;
  }
  step(jump: boolean): void {
    if (this.over) return;
    if (jump && this.air === 0) this.air = 1;
    const h = this.height();
    if (this.tick >= this.start && this.tick <= this.start + 2 && h < 3) {
      this.dead = true;
      return;
    }
    if (this.tick === this.start + 2) {
      this.passed += 1;
      this.start = this.start + 16 + this.draw();
    }
    if (this.air > 0) {
      this.air += 1;
      if (this.air > 12) this.air = 0;
    }
    this.tick += 1;
  }
}

export function replay(seed: bigint, jumps: number[]): number {
  for (let i = 0; i < jumps.length; i++) {
    if (jumps[i] < 0 || jumps[i] >= TICKS || (i > 0 && jumps[i] <= jumps[i - 1])) throw new Error("bad log");
  }
  const s = new Sim(seed);
  let idx = 0;
  while (!s.over) {
    const j = idx < jumps.length && jumps[idx] === s.tick;
    if (j) idx++;
    s.step(j);
  }
  return s.score;
}

/** perfect bot: jumps one tick before every obstacle (used for test vectors) */
export function botLog(seed: bigint): number[] {
  const s = new Sim(seed);
  const log: number[] = [];
  while (!s.over) {
    const j = s.tick === s.start - 1;
    if (j) log.push(s.tick);
    s.step(j);
  }
  return log;
}
