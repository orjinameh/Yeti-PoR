"use client";
import { useEffect, useRef } from "react";
import { Sim, TPS, TICKS } from "@/lib/engine.ts";
import { audio } from "@/lib/audio.ts";
import {
  W, H, GROUND, PX, PLAYER_X, HSCALE, HIT_R, CRYSTAL_W,
  drawBackground, drawGround, drawCrystal, drawYeti, drawSnow, stepSnow, newSnow,
  drawPuffs, stepPuffs, spawnPuffs, panel, text, Puff,
} from "@/lib/art.ts";

type Props = {
  seed: bigint;
  ghost?: number[] | null;
  label?: string;
  onDone: (jumps: number[], score: number) => void;
};

const pad = (n: number, w = 6) => String(n).padStart(w, "0");

export default function Game({ seed, ghost, label, onDone }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const STEP_MS = 1000 / TPS;
    const sim = new Sim(seed);
    const gsim = ghost ? new Sim(seed) : null;
    let gi = 0;
    const jumps: number[] = [];
    const snow = newSnow();
    const puffs: Puff[] = [];

    let phase: "ready" | "play" | "end" = "ready";
    let pending = false;
    let last = performance.now();
    let acc = 0;
    let clock = 0;
    let raf = 0;
    let endAt = 0;
    let finished = false;
    let prevH = 0, curH = 0, gPrevH = 0, gCurH = 0;
    let shake = 0, flash = 0, pop = 0;

    const press = () => {
      if (phase === "ready") {
        audio.unlock();
        audio.start();
        audio.startMusic();
        phase = "play";
        last = performance.now();
        acc = 0;
      } else if (phase === "play") {
        pending = true;
      }
    };
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW" || e.code === "Enter") {
        e.preventDefault();
        if (!e.repeat) press();
      }
    };
    window.addEventListener("keydown", key);
    c.addEventListener("pointerdown", press);

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      if (phase === "play") acc = Math.min(acc + (now - last), STEP_MS * 3);
      last = now;
      clock += dt;

      // ---- fixed-step simulation (same rules as the Move contract) ----
      while (phase === "play" && acc >= STEP_MS && !sim.over) {
        acc -= STEP_MS;
        const j = pending;
        pending = false;
        const wasAir = sim.air > 0;
        const passedBefore = sim.passed;
        if (j) {
          jumps.push(sim.tick);
          if (!wasAir) {
            audio.jump();
            spawnPuffs(puffs, PLAYER_X, GROUND, 6);
          }
        }
        sim.step(j);
        prevH = curH;
        curH = sim.height();
        if (wasAir && sim.air === 0 && !sim.dead) {
          audio.land();
          spawnPuffs(puffs, PLAYER_X, GROUND, 4);
        }
        if (sim.passed > passedBefore) {
          audio.score();
          pop = 1;
        }
        if (gsim && ghost && !gsim.over) {
          const gj = gi < ghost.length && ghost[gi] === gsim.tick;
          if (gj) gi++;
          gsim.step(gj);
          gPrevH = gCurH;
          gCurH = gsim.height();
        }
        if (sim.over) {
          if (sim.dead) {
            audio.die();
            audio.stopMusic(0.7);
            shake = 1;
            flash = 1;
          } else {
            audio.win();
            audio.stopMusic(1.2);
          }
          phase = "end";
          endAt = now;
        }
      }

      const alpha = phase === "play" ? Math.min(1, acc / STEP_MS) : 0;
      const tickF = sim.tick + alpha;
      const scroll = phase === "ready" ? clock * 22 : tickF * PX;
      const speed = phase === "play" ? PX * TPS : phase === "ready" ? 22 : 0;
      stepSnow(snow, dt, speed);
      stepPuffs(puffs, dt);
      shake = Math.max(0, shake - dt * 3);
      flash = Math.max(0, flash - dt * 2.2);
      pop = Math.max(0, pop - dt * 3);

      // ---- draw ----
      ctx.save();
      if (shake > 0) ctx.translate((Math.random() - 0.5) * 12 * shake, (Math.random() - 0.5) * 8 * shake);
      drawBackground(ctx, scroll, clock);
      drawGround(ctx, scroll);

      for (const s of sim.upcoming(5)) {
        const x = PLAYER_X + HIT_R + (s - tickF) * PX;
        if (x > -CRYSTAL_W - 10 && x < W + 10) drawCrystal(ctx, x);
      }

      // ghost (same seed => same course, only the jumps differ)
      if (gsim) {
        const gh = (gPrevH + (gCurH - gPrevH) * alpha) * HSCALE;
        drawYeti(ctx, PLAYER_X, GROUND - gh, {
          t: clock, air: gsim.air > 0, dead: gsim.dead, alpha: 0.38, ghost: true,
        });
      }
      const target = pending && sim.air === 0 ? 9 : curH;
      const h = (prevH + (target - prevH) * alpha) * HSCALE;
      // soft shadow
      ctx.fillStyle = "rgba(20,40,80,0.28)";
      ctx.beginPath();
      ctx.ellipse(PLAYER_X, GROUND + 4, 26 - h * 0.08, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      drawYeti(ctx, PLAYER_X, GROUND - h, { t: clock, air: sim.air > 0 || h > 4, dead: sim.dead });
      drawPuffs(ctx, puffs);
      drawSnow(ctx, snow);
      ctx.restore();

      // HUD
      panel(ctx, 14, 14, 214, 56);
      text(ctx, "SCORE", 28, 36, 9, "#8fc3f5");
      text(ctx, pad(sim.score), 28, 60, 20 + pop * 4);
      const bx = 262, bw = 276;
      panel(ctx, bx - 8, 18, bw + 16, 24);
      ctx.fillStyle = "rgba(160,205,255,0.2)";
      ctx.fillRect(bx, 26, bw, 8);
      ctx.fillStyle = "#7fd4ff";
      ctx.fillRect(bx, 26, bw * (sim.tick / TICKS), 8);
      text(ctx, `${Math.floor((sim.tick / TPS))}s / ${TICKS / TPS}s`, bx + bw / 2, 58, 9, "#8fc3f5", "center");
      panel(ctx, W - 228, 14, 214, 56);
      if (gsim) {
        const d = sim.score - gsim.score;
        text(ctx, "GHOST", W - 214, 36, 9, "#7ff0ff");
        text(ctx, pad(gsim.score), W - 214, 60, 14, "#c8f7ff");
        text(ctx, (d >= 0 ? "+" : "") + d, W - 28, 60, 12, d >= 0 ? "#7dffb2" : "#ff8a8a", "right");
      } else {
        text(ctx, "GATES", W - 214, 36, 9, "#8fc3f5");
        text(ctx, pad(sim.passed, 3), W - 214, 60, 20);
      }

      if (phase === "ready") {
        ctx.fillStyle = "rgba(6,12,30,0.45)";
        ctx.fillRect(0, 0, W, H);
        text(ctx, "YETI PROOF-OF-RUN", W / 2, 150, 26, "#ffffff", "center");
        if (label) text(ctx, label, W / 2, 182, 10, "#8fc3f5", "center");
        if (Math.floor(clock * 2) % 2 === 0) text(ctx, "TAP OR PRESS SPACE TO START", W / 2, 222, 12, "#ffd9a8", "center");
        text(ctx, ghost ? "RACING YOUR GHOST" : "JUMP THE ICE. DON'T CRASH.", W / 2, 252, 9, ghost ? "#7ff0ff" : "#8fc3f5", "center");
      }
      if (phase === "end") {
        if (flash > 0) {
          ctx.fillStyle = `rgba(255,70,90,${flash * 0.35})`;
          ctx.fillRect(0, 0, W, H);
        }
        text(ctx, sim.dead ? "CRASH!" : "FINISH!", W / 2, 170, 34, sim.dead ? "#ff8a8a" : "#7dffb2", "center");
        if (!finished && now - endAt > 1100) {
          finished = true;
          doneRef.current(jumps, sim.score);
        }
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", key);
      c.removeEventListener("pointerdown", press);
      audio.stopMusic(0.1);
    };
  }, [seed, ghost, label]);

  return (
    <canvas
      ref={ref}
      className="game-canvas"
      style={{ width: "100%", aspectRatio: `${W} / ${H}`, touchAction: "manipulation" }}
    />
  );
}
