// Deterministic fixed-point runner engine v2. MUST stay identical to move/sources/proof_of_run.move.
//
// Story: Subject Y-7 (the yeti) escapes Halcyon Station. ENDLESS: the run lasts until you are recaptured, capped at MAX_TICKS (108,000 ticks, 3 hours at base speed). A level is 450 ticks.
// Inputs: a log of jump ticks and a log of shot ticks. Shots are hitscan auto-aim (no projectile sim).
//
// Obstacle kinds (one active at a time, spaced >= 16 ticks apart, each overlapping the player for 3 ticks):
//   0 crate  - hurts you if you are on the ground. Can't be shot. Jump it.
//   1 sentry - big ground enemy, 2 hp (3 from level 6). Too big to jump: it hurts you at any height until you shoot it dead.
//   2 drone  - air enemy, 1 hp. Hurts you if you are airborne. Stay low or shoot it.
export const MAX_TICKS = 108000; // 3 hours at base speed
export const SEG_TICKS = 1800; // one on-chain transaction verifies at most this many ticks (log ticks are segment-relative)
export const TICKS = SEG_TICKS; // kept for older imports
export const TPS = 10;
export const STAGE_TICKS = 450;
export const PROFILE = [9, 16, 22, 27, 30, 31, 31, 30, 27, 22, 16, 9];
export const HP_MAX = 5;
export const INV_TICKS = 6;
export const SHOT_CD = 3;
export const RANGE = 12;
const M = 2147483648n;

const nextR = (r: bigint): bigint => (r * 1103515245n + 12345n) % M;
const drawR = (r: bigint): number => Number((r >> 16n) % 10n);
const rollR = (r: bigint): number => Number((r >> 8n) % 100n);

export function kindFor(roll: number, start: number): number {
  const stage = Math.min(3, Math.floor(start / STAGE_TICKS));
  if (stage === 0) return roll < 70 ? 0 : 1;
  if (stage === 1) return roll < 35 ? 0 : roll < 80 ? 1 : 2;
  if (stage === 2) return roll < 25 ? 0 : roll < 55 ? 1 : 2;
  return roll < 20 ? 0 : roll < 50 ? 1 : 2;
}
/** sentries get tougher from level 6 on (start tick 2700+) */
export const hpFor = (kind: number, start: number): number => (kind === 1 ? (start >= STAGE_TICKS * 6 ? 3 : 2) : kind === 2 ? 1 : 0);
/** unbounded difficulty level, one per 450 ticks */
export const levelOf = (tick: number): number => Math.floor(tick / STAGE_TICKS);
/** which of the 4 environments to draw */
export const stageOf = (tick: number): number => levelOf(tick) % 4;
/** presentation only (not part of verification): the game gets faster each level, so long runs get hard */
export const tpsFor = (tick: number): number => Math.min(18, TPS + 1.25 * levelOf(tick));

export type StepEvents = { fired: boolean; hitEnemy: boolean; killed: boolean; damaged: boolean };
export type Upcoming = { start: number; kind: number; ehp: number };

export class Sim {
  rng: bigint;
  start: number; // first tick of the active obstacle (spans start..start+2)
  kind: number;
  ehp: number; // enemy hp left (kinds 1, 2)
  tick = 0;
  air = 0;
  passed = 0;
  kills = 0;
  hp = HP_MAX;
  inv = 0;
  cd = 0;
  dead = false;
  ev: StepEvents = { fired: false, hitEnemy: false, killed: false, damaged: false };

  constructor(seed: bigint) {
    this.rng = nextR(seed % M);
    this.start = 20 + drawR(this.rng);
    this.kind = kindFor(rollR(this.rng), this.start);
    this.ehp = hpFor(this.kind, this.start);
  }
  height(): number {
    return this.air === 0 ? 0 : PROFILE[this.air - 1];
  }
  get over(): boolean {
    return this.dead || this.tick >= MAX_TICKS;
  }
  get escaped(): boolean {
    return !this.dead && this.tick >= MAX_TICKS;
  }
  get score(): number {
    return this.passed * 100 + this.tick + this.kills * 50 + (this.escaped ? this.hp * 50 : 0);
  }
  /** can a shot taken this tick actually fire? */
  canShoot(): boolean {
    return this.cd <= 1;
  }
  /** is there an enemy the auto-aim would hit right now? */
  hasTarget(): boolean {
    return this.kind > 0 && this.ehp > 0 && this.tick <= this.start + 2 && this.start <= this.tick + RANGE;
  }
  /** upcoming obstacles (does not mutate state) */
  upcoming(n: number): Upcoming[] {
    const out: Upcoming[] = [{ start: this.start, kind: this.kind, ehp: this.ehp }];
    let r = this.rng;
    let s = this.start;
    while (out.length < n) {
      r = nextR(r);
      s = s + 16 + drawR(r);
      const k = kindFor(rollR(r), s);
      out.push({ start: s, kind: k, ehp: hpFor(k, s) });
    }
    return out;
  }
  step(jump: boolean, shoot: boolean): void {
    if (this.over) return;
    this.ev = { fired: false, hitEnemy: false, killed: false, damaged: false };
    if (jump && this.air === 0) this.air = 1;
    if (this.cd > 0) this.cd -= 1;
    if (shoot && this.cd === 0) {
      this.cd = SHOT_CD;
      this.ev.fired = true;
      if (this.kind > 0 && this.ehp > 0 && this.tick <= this.start + 2 && this.start <= this.tick + RANGE) {
        this.ehp -= 1;
        this.ev.hitEnemy = true;
        if (this.ehp === 0) {
          this.kills += 1;
          this.ev.killed = true;
        }
      }
    }
    const h = this.height();
    if (this.inv > 0) this.inv -= 1;
    if (this.tick >= this.start && this.tick <= this.start + 2 && this.inv === 0) {
      const danger =
        this.kind === 0 ? h < 3 : this.ehp === 0 ? false : this.kind === 1 ? true : h >= 3;
      if (danger) {
        this.hp -= 1;
        this.inv = INV_TICKS;
        this.ev.damaged = true;
        if (this.hp === 0) {
          this.dead = true;
          return;
        }
      }
    }
    if (this.tick === this.start + 2) {
      this.passed += 1;
      this.rng = nextR(this.rng);
      this.start = this.start + 16 + drawR(this.rng);
      this.kind = kindFor(rollR(this.rng), this.start);
      this.ehp = hpFor(this.kind, this.start);
    }
    if (this.air > 0) {
      this.air += 1;
      if (this.air > 12) this.air = 0;
    }
    this.tick += 1;
  }
}

/** Logs are ABSOLUTE ticks here; on-chain they are split per segment (see splitSegments). */
function checkLog(log: number[]): void {
  for (let i = 0; i < log.length; i++) {
    if (!Number.isInteger(log[i]) || log[i] < 0 || log[i] >= MAX_TICKS || (i > 0 && log[i] <= log[i - 1])) throw new Error("bad log");
  }
}

export function replay(seed: bigint, jumps: number[], shots: number[]): number {
  checkLog(jumps);
  checkLog(shots);
  const s = new Sim(seed);
  let ji = 0;
  let si = 0;
  while (!s.over) {
    const j = ji < jumps.length && jumps[ji] === s.tick;
    if (j) ji++;
    const f = si < shots.length && shots[si] === s.tick;
    if (f) si++;
    s.step(j, f);
  }
  return s.score;
}

export type Segment = { jumps: number[]; shots: number[] };

/** Splits an absolute-tick run into on-chain segments of SEG_TICKS (log ticks become segment-relative).
 *  The number of segments is ceil(finalTick / SEG_TICKS), at least 1. */
export function splitSegments(jumps: number[], shots: number[], finalTick: number): Segment[] {
  const n = Math.max(1, Math.ceil(finalTick / SEG_TICKS));
  const out: Segment[] = [];
  for (let k = 0; k < n; k++) {
    const lo = k * SEG_TICKS, hi = lo + SEG_TICKS;
    out.push({
      jumps: jumps.filter((t) => t >= lo && t < hi).map((t) => t - lo),
      shots: shots.filter((t) => t >= lo && t < hi).map((t) => t - lo),
    });
  }
  return out;
}

/** reference bot (used for test vectors): jumps crates, shoots sentries and drones as soon as they are in range */
export function botLog(seed: bigint, maxTick = SEG_TICKS * 2): { jumps: number[]; shots: number[] } {
  const s = new Sim(seed);
  const jumps: number[] = [];
  const shots: number[] = [];
  while (!s.over && s.tick < maxTick) {
    const j = s.kind === 0 && s.tick === s.start - 1;
    const f = s.hasTarget() && s.canShoot();
    if (j) jumps.push(s.tick);
    if (f) shots.push(s.tick);
    s.step(j, f);
  }
  return { jumps, shots };
}
