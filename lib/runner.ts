// Framework-free game runner: owns the canvas, the fixed-step sim loop, rendering and the input API.
// The React console (components/Console.tsx) only calls start / jump / fire / pause / resume / destroy.
import { Sim, TPS, STAGE_TICKS, HP_MAX, stageOf, levelOf, tpsFor, LANE_H } from "./engine.ts";
import { audio } from "./audio.ts";
import { Sprites } from "./sprites.ts";
import {
  W, H, GROUND, PX, PLAYER_X, HSCALE, HIT_R, STAGES, PIXEL,
  drawBackground, drawMeat, drawSentry, drawDrone, drawYeti, drawSnow, stepSnow, newSnow,
  drawSparks, stepSparks, burst, dust, drawShot, enemyCenter, metal, rr, px, drawPortrait, segBar, drawCrosshair,
  Spark, Shot,
} from "./art.ts";

export type Ghost = { jumps: number[]; shots: number[] };
export type Done = { jumps: number[]; shots: number[]; score: number; kills: number; meat: number; hp: number; escaped: boolean; stage: number; ticks: number };
export type RunnerOpts = { seed: bigint; ghost?: Ghost | null; tutorial?: boolean; onDone: (d: Done) => void };
type Phase = "attract" | "count" | "play" | "end";

const pad = (n: number, w = 6) => String(n).padStart(w, "0");
const COUNT_STEP = 0.72;

export class Runner {
  phase: Phase = "attract";
  paused = false;

  private ctx: CanvasRenderingContext2D;
  private sim: Sim;
  private gsim: Sim | null;
  private ghost: Ghost | null;
  private tutorial: boolean;
  private onDone: (d: Done) => void;
  private sprites = new Sprites();
  private ro: ResizeObserver | null = null;

  private gji = 0; private gsi = 0;
  private jumps: number[] = [];
  private shots: number[] = [];
  private snow = newSnow();
  private sparks: Spark[] = [];
  private bolts: Shot[] = [];
  private floaters: { x: number; y: number; s: string; life: number }[] = [];

  private jumpPending = false; private firePending = false; private fireHeld = false;
  private acc = 0; private clock = 0; private countT = 0; private endT = 0;
  private last = 0; private raf = 0; private finished = false;
  private prevH = 0; private curH = 0; private gPrevH = 0; private gCurH = 0;
  private shake = 0; private redFlash = 0; private hurtT = 0; private fireT = 0; private eFlash = 0;
  private pop = 0; private transFlash = 0; private capT = 0; private cardT = 0;
  private curStage = 0;
  private lastCount = 4;

  constructor(private canvas: HTMLCanvasElement, opts: RunnerOpts) {
    this.ctx = canvas.getContext("2d")!;
    this.sim = new Sim(opts.seed);
    this.ghost = opts.ghost ?? null;
    this.gsim = this.ghost ? new Sim(opts.seed) : null;
    this.tutorial = !!opts.tutorial;
    this.onDone = opts.onDone;
    this.fit();
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.fit());
      this.ro.observe(canvas);
    }
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** match the backing store to the displayed size so the art stays crisp on big screens */
  private fit(): void {
    const css = this.canvas.clientWidth || W;
    const scale = Math.min(3, Math.max(1, (css / W) * (window.devicePixelRatio || 1)));
    const w = Math.round(W * scale), h = Math.round(H * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.setTransform(w / W, 0, 0, h / H, 0, 0);
  }

  // ---------- public API ----------
  start(): void {
    if (this.phase !== "attract") return;
    audio.unlock();
    audio.startMusic();
    this.phase = "count";
    this.countT = 0;
    this.lastCount = 4;
  }
  jump(): void { if (this.phase === "play" && !this.paused) this.jumpPending = true; }
  fire(on: boolean): void {
    this.fireHeld = on;
    if (on && this.phase === "play" && !this.paused) this.firePending = true;
  }
  pause(): void { if (this.phase === "play" || this.phase === "count") this.paused = true; }
  resume(): void { if (this.paused) { this.paused = false; this.last = performance.now(); } }
  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
  }

  // ---------- loop ----------
  private frame = (now: number): void => {
    const dt = this.paused ? 0 : Math.min(0.05, (now - this.last) / 1000);
    const stepMs = 1000 / tpsFor(this.sim.tick);
    if (!this.paused && this.phase === "play") this.acc = Math.min(this.acc + (now - this.last), stepMs * 3);
    this.last = now;
    this.clock += dt;

    if (this.phase === "count") {
      this.countT += dt;
      const n = 3 - Math.floor(this.countT / COUNT_STEP);
      if (n !== this.lastCount && n >= 0) { this.lastCount = n; if (n > 0) audio.blip(false); else audio.blip(true); }
      if (this.countT >= COUNT_STEP * 4) { this.phase = "play"; this.acc = 0; this.capT = 0; this.cardT = 0; audio.start(); }
    }

    if (this.phase === "play") this.simulate(now, stepMs);
    this.update(dt);
    this.draw(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  private simulate(now: number, stepMs: number): void {
    const sim = this.sim;
    let stepMs2 = 1000 / tpsFor(sim.tick);
    while (this.acc >= stepMs2 && !sim.over) {
      this.acc -= stepMs2;
      const j = this.jumpPending;
      this.jumpPending = false;
      const want = this.fireHeld || this.firePending;
      this.firePending = false;
      const f = want && sim.hasTarget() && sim.canShoot();
      const wasAir = sim.air > 0;
      const passed0 = sim.passed;
      const tKind = sim.kind;
      const tx = PLAYER_X + HIT_R + (sim.start - sim.tick) * PX;
      if (j) {
        this.jumps.push(sim.tick);
        if (!wasAir) { audio.jump(); dust(this.sparks, PLAYER_X, GROUND, 6); }
      }
      if (f) this.shots.push(sim.tick);
      sim.step(j, f);
      this.prevH = this.curH;
      this.curH = sim.height();

      const ev = sim.ev;
      if (ev.fired) {
        audio.shoot();
        this.fireT = 1;
        const [ex, ey] = enemyCenter(tKind, tx);
        this.bolts.push({ x0: PLAYER_X + 58, y0: GROUND - this.prevH * HSCALE - 68, x1: ex, y1: ey, t: 0 });
        if (ev.hitEnemy) { this.eFlash = 1; audio.hit(); }
        if (ev.killed) {
          audio.boom();
          burst(this.sparks, ex, ey, 26, ["#ff9a4d", "#ffd29a", "#ffffff", "#7fd4ff"]);
          this.floaters.push({ x: ex, y: ey - 22, s: "+50", life: 1 });
          this.pop = 1;
        }
      }
      if (ev.collected) {
        audio.chomp();
        burst(this.sparks, PLAYER_X + 30, GROUND - this.curH * HSCALE - 60, 14, ["#ff6f7d", "#ffd0d0", "#ffffff"]);
        this.floaters.push({ x: PLAYER_X + 40, y: GROUND - this.curH * HSCALE - 100, s: "+25", life: 1 });
        this.pop = Math.max(this.pop, 0.8);
      }
      if (ev.damaged) {
        audio.hurt();
        this.hurtT = 1;
        this.shake = Math.max(this.shake, 0.7);
        this.redFlash = 0.8;
        burst(this.sparks, PLAYER_X, GROUND - 60, 12, ["#ffffff", "#9fd4ff"], 120);
      }
      if (wasAir && sim.air === 0 && !sim.dead) { audio.land(); dust(this.sparks, PLAYER_X, GROUND, 4); }
      if (sim.passed > passed0) this.pop = Math.max(this.pop, 0.6);
      const st = levelOf(sim.tick);
      stepMs2 = 1000 / tpsFor(sim.tick);
      if (st !== this.curStage && !sim.over) { this.curStage = st; this.capT = 0; this.cardT = 0; this.transFlash = 1; audio.stage(); }

      if (this.gsim && this.ghost && !this.gsim.over) {
        const gj = this.gji < this.ghost.jumps.length && this.ghost.jumps[this.gji] === this.gsim.tick;
        if (gj) this.gji++;
        const gf = this.gsi < this.ghost.shots.length && this.ghost.shots[this.gsi] === this.gsim.tick;
        if (gf) this.gsi++;
        this.gsim.step(gj, gf);
        this.gPrevH = this.gCurH;
        this.gCurH = this.gsim.height();
      }
      if (sim.over) {
        if (sim.dead) { audio.die(); audio.stopMusic(0.7); this.shake = 1; this.redFlash = 1; }
        else { audio.win(); audio.stopMusic(1.2); }
        this.phase = "end";
        this.endT = 0;
      }
    }
  }

  private update(dt: number): void {
    stepSnow(this.snow, dt, this.phase === "play" ? PX * tpsFor(this.sim.tick) : 22);
    stepSparks(this.sparks, dt);
    for (const b of this.bolts) b.t += dt * 7;
    for (let i = this.bolts.length - 1; i >= 0; i--) if (this.bolts[i].t > 1.05) this.bolts.splice(i, 1);
    for (const fl of this.floaters) { fl.y -= 30 * dt; fl.life -= dt * 1.1; }
    for (let i = this.floaters.length - 1; i >= 0; i--) if (this.floaters[i].life <= 0) this.floaters.splice(i, 1);
    this.shake = Math.max(0, this.shake - dt * 3);
    this.redFlash = Math.max(0, this.redFlash - dt * 2);
    this.hurtT = Math.max(0, this.hurtT - dt * 1.3);
    this.fireT = Math.max(0, this.fireT - dt * 6);
    this.eFlash = Math.max(0, this.eFlash - dt * 7);
    this.pop = Math.max(0, this.pop - dt * 3);
    this.transFlash = Math.max(0, this.transFlash - dt * 1.8);
    if (this.phase === "play") { this.capT += dt; this.cardT += dt; }
    if (this.phase === "end") {
      this.endT += dt;
      if (!this.finished && this.endT > 1.3) {
        this.finished = true;
        const s = this.sim;
        this.onDone({ jumps: this.jumps, shots: this.shots, score: s.score, kills: s.kills, meat: s.meat, hp: s.hp, escaped: s.escaped, stage: levelOf(s.tick), ticks: s.tick });
      }
    }
  }

  // ---------- drawing ----------
  private draw(now: number): void {
    const ctx = this.ctx, sim = this.sim, clock = this.clock;
    const stepMs = 1000 / tpsFor(sim.tick);
    const attract = this.phase === "attract";
    const alpha = this.phase === "play" ? Math.min(1, this.acc / stepMs) : 0;
    const tickF = sim.tick + alpha;
    const scroll = attract || this.phase === "count" ? clock * 26 : tickF * PX;
    const stage = attract ? 0 : stageOf(sim.tick);

    ctx.save();
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * 10 * this.shake, (Math.random() - 0.5) * 7 * this.shake);
    drawBackground(ctx, stage, scroll, clock, tickF);

    if (!attract) {
      sim.upcoming(4).forEach((u, idx) => {
        const x = PLAYER_X + HIT_R + (u.start - tickF) * PX;
        if (x < -80 || x > W + 20) return;
        if (u.kind === 0) { if (u.ehp > 0) drawMeat(ctx, x, LANE_H[u.lane] * HSCALE, clock); }
        else if (u.kind === 1 && u.ehp > 0) drawSentry(ctx, x, clock, u.ehp, idx === 0 ? this.eFlash : 0);
        else if (u.kind === 2 && u.ehp > 0) drawDrone(ctx, x, clock, idx === 0 ? this.eFlash : 0, sim.air > 0);
      });
    }

    if (this.gsim && !attract) {
      const gh = (this.gPrevH + (this.gCurH - this.gPrevH) * alpha) * HSCALE;
      drawYeti(ctx, PLAYER_X, GROUND - gh, { t: clock, air: this.gsim.air > 0, dead: this.gsim.dead, alpha: 0.36, ghost: true });
    }
    const target = this.jumpPending && sim.air === 0 && this.phase === "play" ? 9 : this.curH;
    const h = (this.prevH + (target - this.prevH) * alpha) * HSCALE;
    ctx.fillStyle = "rgba(10,20,45,0.32)";
    ctx.beginPath();
    ctx.ellipse(PLAYER_X, GROUND + 5, Math.max(10, 32 - h * 0.09), 7, 0, 0, Math.PI * 2);
    ctx.fill();
    const idle = attract || this.phase === "count";
    drawYeti(ctx, PLAYER_X, GROUND - h, { t: clock, air: sim.air > 0 || h > 4, dead: sim.dead, hurt: this.hurtT, firing: this.fireT, idle }, this.sprites);
    for (const b of this.bolts) drawShot(ctx, b);
    drawSparks(ctx, this.sparks);
    drawSnow(ctx, this.snow, stage === 3 ? 1 : 0.35);
    for (const fl of this.floaters) px(ctx, fl.s, fl.x, fl.y, 13, `rgba(255,214,150,${Math.max(0, fl.life)})`, "center", `rgba(10,16,32,${Math.max(0, fl.life)})`);
    ctx.restore();

    if (this.transFlash > 0) { ctx.fillStyle = `rgba(235,245,255,${this.transFlash * 0.4})`; ctx.fillRect(0, 0, W, H); }
    if (this.redFlash > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.65);
      g.addColorStop(0, "rgba(255,60,80,0)");
      g.addColorStop(1, `rgba(255,60,80,${this.redFlash * 0.55})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    if (!attract) this.drawHud(ctx, stage);
    if (this.phase === "count") this.drawCount(ctx);
    if (this.phase === "play") this.drawPrompts(ctx, stage);
    if (this.phase === "end") this.drawEnd(ctx);
  }

  private drawHud(ctx: CanvasRenderingContext2D, stage: number): void {
    const sim = this.sim, clock = this.clock;
    // health
    metal(ctx, 14, 14, 262, 60, 10);
    drawPortrait(ctx, 22, 22, 44, this.hurtT > 0);
    px(ctx, "Y-7", 78, 40, 11, "#cfe3ff");
    segBar(ctx, 78, 48, HP_MAX, sim.hp, 32, 14, 4, this.hurtT > 0 && Math.floor(clock * 14) % 2 === 0);
    // score
    metal(ctx, 296, 16, 208, 40, 10);
    px(ctx, "SCORE", 312, 41, 9, "#8fb6e8");
    px(ctx, pad(sim.score), 490, 43 - this.pop * 1.5, 17 + this.pop * 3, "#ffffff", "right");
    if (this.gsim) {
      const d = sim.score - this.gsim.score;
      metal(ctx, 336, 62, 128, 22, 8);
      px(ctx, `GHOST ${d >= 0 ? "+" : ""}${d}`, 400, 78, 9, d >= 0 ? "#7dffb2" : "#ff9a9a", "center");
    }
    // meat collected
    metal(ctx, 14, 82, 118, 30, 9);
    px(ctx, "MEAT", 26, 102, 9, "#ff9aa6");
    px(ctx, String(sim.meat).padStart(3, "0"), 120, 104, 13, "#ffffff", "right");
    // takedowns + distance
    metal(ctx, 524, 16, 262, 40, 10);
    drawCrosshair(ctx, 548, 36, 7, "#ffb27a");
    px(ctx, `x ${String(sim.kills).padStart(3, "0")}`, 564, 42, 13, "#ffffff");
    ctx.fillStyle = "rgba(170,200,255,0.3)"; ctx.fillRect(650, 24, 2, 24);
    px(ctx, `${String(Math.floor(sim.tick * 1.5)).padStart(4, "0")} M`, 772, 42, 13, "#ffffff", "right");
    // stage progress
    rr(ctx, 524, 62, 262, 7, 3.5); ctx.fillStyle = "rgba(10,14,28,0.75)"; ctx.fill();
    const pw = Math.max(7, 262 * ((sim.tick % STAGE_TICKS) / STAGE_TICKS));
    rr(ctx, 524, 62, pw, 7, 3.5);
    const pg = ctx.createLinearGradient(524, 0, 786, 0); pg.addColorStop(0, "#7fd4ff"); pg.addColorStop(1, "#ffd29a");
    ctx.fillStyle = pg; ctx.fill();
    ctx.fillStyle = "rgba(10,14,28,0.95)";
    for (const q of [0.25, 0.5, 0.75]) ctx.fillRect(524 + 262 * q - 1, 62, 2, 7);
    // stage tag
    metal(ctx, 14, H - 40, 206, 26, 8);
    px(ctx, `LEVEL ${levelOf(sim.tick) + 1}`, 26, H - 22, 10, "#ffb27a");
    px(ctx, STAGES[stage].name, 104, H - 22, 10, "#dbe8ff");
    // story caption
    if (this.phase === "play" && this.capT < 4.4) {
      const line = STAGES[stage].line;
      const n = Math.min(line.length, Math.floor(this.capT * 38));
      const a = this.capT > 3.7 ? Math.max(0, (4.4 - this.capT) / 0.7) : 1;
      ctx.font = `10px ${PIXEL}`;
      const w = Math.max(160, ctx.measureText(line).width + 40);
      ctx.globalAlpha = a;
      metal(ctx, W / 2 - w / 2, H - 52, w, 32, 10);
      px(ctx, line.slice(0, n), W / 2, H - 31, 10, "#ffffff", "center");
      ctx.globalAlpha = 1;
    }
  }

  private drawPrompts(ctx: CanvasRenderingContext2D, stage: number): void {
    // stage title card
    if (this.cardT < 1.9) {
      const a = Math.min(1, this.cardT / 0.25) * Math.min(1, (1.9 - this.cardT) / 0.4);
      ctx.globalAlpha = a;
      px(ctx, `LEVEL ${levelOf(this.sim.tick) + 1}`, W / 2, 150, 13, "#ffb27a", "center");
      px(ctx, STAGES[stage].name, W / 2, 188, 28, "#ffffff", "center");
      ctx.globalAlpha = 1;
    }
    if (this.tutorial && this.sim.tick < 80 && this.cardT > 1.9) {
      const a = Math.min(1, (80 - this.sim.tick) / 15);
      ctx.globalAlpha = a;
      px(ctx, "TAP THE ARROW PAD OR PRESS SPACE TO JUMP", W / 2, 150, 12, "#ffffff", "center");
      px(ctx, "HOLD FIRE OR F TO AUTO-AIM", W / 2, 180, 12, "#ffffff", "center");
      ctx.globalAlpha = 1;
    }
  }

  private drawCount(ctx: CanvasRenderingContext2D): void {
    const n = 3 - Math.floor(this.countT / COUNT_STEP);
    const local = (this.countT % COUNT_STEP) / COUNT_STEP;
    const s = n > 0 ? String(n) : "GO";
    const sc = 1 + (1 - Math.min(1, local * 2.2)) * 0.5;
    ctx.save();
    ctx.translate(W / 2, 205);
    ctx.scale(sc, sc);
    ctx.globalAlpha = 1 - Math.max(0, local - 0.7) / 0.3 * 0.6;
    px(ctx, s, 0, 24, n > 0 ? 72 : 60, n > 0 ? "#ffffff" : "#7dffb2", "center");
    ctx.restore();
    ctx.globalAlpha = 1;
    px(ctx, STAGES[0].name, W / 2, 112, 13, "#ffb27a", "center");
    if (this.ghost) px(ctx, "GHOST ARMED", W / 2, 296, 11, "#7ff0ff", "center");
  }

  private drawEnd(ctx: CanvasRenderingContext2D): void {
    const dead = this.sim.dead;
    ctx.fillStyle = dead ? "rgba(20,4,10,0.38)" : "rgba(235,248,255,0.14)";
    ctx.fillRect(0, 0, W, H);
    const a = Math.min(1, this.endT / 0.4);
    ctx.globalAlpha = a;
    px(ctx, dead ? "RECAPTURED" : "FREE", W / 2, 205, 40, dead ? "#ff8a9a" : "#a8ffd0", "center");
    px(ctx, dead ? "Halcyon always catches up." : "He never looked back.", W / 2, 240, 11, "#ffffff", "center");
    ctx.globalAlpha = 1;
  }
}
