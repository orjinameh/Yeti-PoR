"use client";
import { useEffect, useRef } from "react";
import { Sim, TPS, TICKS } from "@/lib/engine.ts";

type Props = { seed: bigint; onDone: (jumps: number[], score: number) => void };

const W = 640, H = 240, GROUND = 190, PX = 14, PLAYER_X = 90;

export default function Game({ seed, onDone }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const sim = new Sim(seed);
    const jumps: number[] = [];
    let pending = false;
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    let finished = false;

    const press = () => { pending = true; };
    const key = (e: KeyboardEvent) => { if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); press(); } };
    window.addEventListener("keydown", key);
    c.addEventListener("pointerdown", press);

    const draw = () => {
      ctx.fillStyle = "#101a3a"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#1c2b5e"; ctx.fillRect(0, GROUND, W, H - GROUND);
      for (const s of sim.upcoming(6)) {
        const x = PLAYER_X + (s - sim.tick) * PX;
        if (x > -60 && x < W) { ctx.fillStyle = "#7fd4ff"; ctx.fillRect(x, GROUND - 34, 3 * PX, 34); }
      }
      const y = GROUND - 30 - sim.height() * 3.2;
      ctx.fillStyle = sim.dead ? "#ff5b6e" : "#f4f8ff"; ctx.fillRect(PLAYER_X - 14, y, 28, 30);
      ctx.fillStyle = "#0b1020"; ctx.fillRect(PLAYER_X + 2, y + 8, 5, 5);
      ctx.fillStyle = "#e8f0ff"; ctx.font = "16px system-ui";
      ctx.fillText(`score ${sim.score}   tick ${sim.tick}/${TICKS}`, 12, 24);
    };

    const loop = (now: number) => {
      acc += now - last; last = now;
      while (acc >= 1000 / TPS && !sim.over) {
        acc -= 1000 / TPS;
        const j = pending; pending = false;
        if (j) jumps.push(sim.tick);
        sim.step(j);
      }
      draw();
      if (sim.over && !finished) { finished = true; onDone(jumps, sim.score); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", key); c.removeEventListener("pointerdown", press); };
  }, [seed, onDone]);

  return <canvas ref={ref} width={W} height={H} style={{ width: "100%", maxWidth: W, borderRadius: 12, touchAction: "manipulation" }} />;
}
