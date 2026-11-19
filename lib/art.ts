// Original vector art for "Escape from Halcyon". Smooth curves, soft gradients, rounded shapes only.
// World is 800x450 (16:9). Everything is drawn with canvas calls, no asset files required.
// An official sprite sheet can replace the vector yeti: see lib/sprites.ts.
import type { Sprites } from "./sprites.ts";

export const W = 800;
export const H = 450;
export const GROUND = 372;
export const PX = 24; // pixels per sim tick
export const PLAYER_X = 170;
export const HSCALE = 4.2; // sim height unit -> px. Airborne minimum (9 units) = 38px, ground obstacles are shorter.
export const OB_W = 46; // obstacle width. Overlap lasts (OB_W + 2*HIT_R) / PX = 3 ticks
export const HIT_R = 13;
export const DRONE_Y = GROUND - 162; // grounded yeti walks beneath, a jumping yeti is inside the scan beam
export const PIXEL = "'Silkscreen', 'Press Start 2P', 'Courier New', monospace";
export const SANS = "'Space Grotesk', 'Inter', system-ui, sans-serif";
const TAU = Math.PI * 2;
const G = GROUND;

type Ctx = CanvasRenderingContext2D;

export const STAGES = [
  { name: "CELL BLOCK", line: "The lock failed. Nobody noticed. Run." },
  { name: "LAB CORRIDOR", line: "The sentries are waking up. Shoot, or jump." },
  { name: "CARGO BAY", line: "Drones overhead. Stay low, or shoot them down." },
  { name: "THE BREAKOUT", line: "Cold air. The mountain is right there." },
];

// ---------- primitives ----------
export function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
function vgrad(ctx: Ctx, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
function glow(ctx: Ctx, x: number, y: number, r: number, color: string, a: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace("A", String(a)));
  g.addColorStop(1, color.replace("A", "0"));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
/** soft fur: an ellipse plus a ring of overlapping circles = scalloped cloud edge, never spiky */
function cloud(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, fill: string | CanvasGradient, bumps = 10): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.92, ry * 0.92, 0, 0, TAU);
  ctx.fill();
  const r = Math.min(rx, ry) * 0.34;
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * TAU + 0.3;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * rx * 0.78, cy + Math.sin(a) * ry * 0.78, r, 0, TAU);
    ctx.fill();
  }
}

// ---------- pixel text (HUD voice) ----------
export function px(ctx: Ctx, s: string, x: number, y: number, size: number, color = "#ffffff", align: CanvasTextAlign = "left", outline = "#0a1020"): void {
  ctx.font = `${size}px ${PIXEL}`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, size * 0.34);
  ctx.strokeStyle = outline;
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}
export function sans(ctx: Ctx, s: string, x: number, y: number, size: number, color = "#eaf4ff", align: CanvasTextAlign = "left", weight = 700): void {
  ctx.font = `${weight} ${size}px ${SANS}`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillText(s, x, y + 1.5);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

// ---------- particles ----------
export type Flake = { x: number; y: number; r: number; v: number; s: number };
export type Spark = { x: number; y: number; vx: number; vy: number; life: number; r: number; c: string; g: number };
export type Shot = { x0: number; y0: number; x1: number; y1: number; t: number };

export function newSnow(n = 46): Flake[] {
  return Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 0.8 + Math.random() * 2, v: 14 + Math.random() * 30, s: Math.random() * TAU }));
}
export function stepSnow(f: Flake[], dt: number, speed: number): void {
  for (const p of f) {
    p.y += p.v * dt;
    p.x -= (speed * 0.3 + 10 + p.r * 5) * dt;
    p.s += dt * 1.4;
    if (p.y > H) { p.y = -4; p.x = Math.random() * (W + 80); }
    if (p.x < -6) p.x = W + 6;
  }
}
export function drawSnow(ctx: Ctx, f: Flake[], amount: number): void {
  if (amount <= 0) return;
  ctx.fillStyle = "#fff";
  for (const p of f) {
    ctx.globalAlpha = (0.25 + p.r / 5) * amount;
    ctx.beginPath();
    ctx.arc(p.x + Math.sin(p.s) * 5, p.y, p.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
export function burst(p: Spark[], x: number, y: number, n: number, colors: string[], speed = 160, g = 220): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const v = speed * (0.35 + Math.random() * 0.65);
    p.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.5 + Math.random() * 0.5, r: 1.6 + Math.random() * 3.2, c: colors[i % colors.length], g });
  }
}
export function dust(p: Spark[], x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++)
    p.push({ x, y, vx: -40 - Math.random() * 90, vy: -15 - Math.random() * 35, life: 0.55 + Math.random() * 0.4, r: 2 + Math.random() * 2.4, c: "#ffffff", g: 40 });
}
export function stepSparks(p: Spark[], dt: number): void {
  for (const q of p) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += q.g * dt; q.life -= dt * 1.7; }
  for (let i = p.length - 1; i >= 0; i--) if (p[i].life <= 0) p.splice(i, 1);
}
export function drawSparks(ctx: Ctx, p: Spark[]): void {
  for (const q of p) {
    ctx.globalAlpha = clamp(q.life) * 0.85;
    ctx.fillStyle = q.c;
    ctx.beginPath();
    ctx.arc(q.x, q.y, q.r * (0.6 + q.life * 0.6), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
export function drawShot(ctx: Ctx, s: Shot): void {
  const k = Math.min(1, s.t);
  const x = lerp(s.x0, s.x1, k), y = lerp(s.y0, s.y1, k);
  const tx = lerp(s.x0, s.x1, Math.max(0, k - 0.35)), ty = lerp(s.y0, s.y1, Math.max(0, k - 0.35));
  const g = ctx.createLinearGradient(tx, ty, x, y);
  g.addColorStop(0, "rgba(127,240,255,0)");
  g.addColorStop(1, "rgba(200,250,255,0.95)");
  ctx.strokeStyle = g;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
  glow(ctx, x, y, 16, "rgba(140,235,255,A)", 0.9);
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(x, y, 3.6, 0, TAU); ctx.fill();
}

// ---------- stage floors ----------
function floor(ctx: Ctx, stage: number, scroll: number): void {
  const pal = [
    ["#2f3f6a", "#121a33", "rgba(130,170,240,0.22)"],
    ["#eaf3ff", "#9db9de", "rgba(90,130,190,0.28)"],
    ["#3d3544", "#1b1722", "rgba(255,170,90,0.20)"],
    ["#f3f9ff", "#7fa6d6", "rgba(90,130,190,0.32)"],
  ][stage];
  ctx.fillStyle = vgrad(ctx, G, H, [[0, pal[0]], [1, pal[1]]]);
  ctx.fillRect(0, G, W, H - G);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(0, G, W, 2);
  ctx.strokeStyle = pal[2];
  ctx.lineWidth = 2;
  const gap = stage === 3 ? 76 : 60;
  const off = scroll % gap;
  for (let x = -off; x < W + gap; x += gap) {
    ctx.beginPath(); ctx.moveTo(x, G + 2); ctx.lineTo(x - 30, H); ctx.stroke();
  }
  if (stage === 2) {
    ctx.fillStyle = "rgba(255,170,60,0.9)";
    const hz = scroll % 40;
    for (let x = -hz; x < W + 40; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, G + 8); ctx.lineTo(x + 20, G + 8); ctx.lineTo(x + 12, G + 17); ctx.lineTo(x - 8, G + 17); ctx.closePath(); ctx.fill();
    }
  }
  ctx.fillStyle = vgrad(ctx, G, G + 30, [[0, "rgba(255,255,255,0.2)"], [1, "rgba(255,255,255,0)"]]);
  ctx.fillRect(0, G, W, 30);
}

function ridge(ctx: Ctx, scroll: number, base: number, amp: number, freq: number, c0: string, c1: string, seed: number): void {
  ctx.beginPath();
  ctx.moveTo(0, H);
  let top = H;
  for (let x = 0; x <= W + 8; x += 6) {
    const u = (x + scroll) * freq + seed;
    const n = Math.abs(Math.sin(u) * 0.55 + Math.sin(u * 2.3 + 1.7) * 0.3 + Math.sin(u * 5.1 + 0.4) * 0.15);
    const y = base - n * amp;
    top = Math.min(top, y);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, top, base + 20, [[0, c0], [0.55, c1], [1, c1]]);
  ctx.fill();
}

// ---------- stage backgrounds ----------
function cellBlock(ctx: Ctx, scroll: number, t: number): void {
  ctx.fillStyle = vgrad(ctx, 0, G, [[0, "#0a1430"], [1, "#1e3463"]]);
  ctx.fillRect(0, 0, W, H);
  const tp = 270, to = (scroll * 0.3) % tp;
  const base = Math.floor((scroll * 0.3) / tp);
  for (let x = -to - 40, i = 0; x < W + tp; x += tp, i++) {
    rr(ctx, x, 88, 74, 236, 36);
    ctx.fillStyle = vgrad(ctx, 88, 324, [[0, "rgba(90,200,255,0.30)"], [1, "rgba(30,90,160,0.18)"]]);
    ctx.fill();
    ctx.strokeStyle = "rgba(150,215,255,0.35)"; ctx.lineWidth = 2; ctx.stroke();
    glow(ctx, x + 37, 206, 84, "rgba(90,200,255,A)", 0.35);
    if ((base + i) % 3 !== 0) {
      ctx.fillStyle = "rgba(10,25,55,0.55)";
      ctx.beginPath(); ctx.ellipse(x + 37, 240, 17, 46, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 37, 176, 15, 0, TAU); ctx.fill();
    }
    rr(ctx, x - 6, 312, 86, 18, 9); ctx.fillStyle = "#1b2748"; ctx.fill();
    rr(ctx, x - 6, 78, 86, 16, 8); ctx.fill();
  }
  ctx.strokeStyle = "rgba(140,180,255,0.10)"; ctx.lineWidth = 2;
  const sp = 160, so = (scroll * 0.55) % sp;
  for (let x = -so; x < W + sp; x += sp) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, G); ctx.stroke(); }
  rr(ctx, -10, -10, W + 20, 40, 16); ctx.fillStyle = vgrad(ctx, -10, 30, [[0, "#26335a"], [1, "#141c38"]]); ctx.fill();
  const lp = 420, lo = (scroll * 0.6) % lp;
  for (let x = -lo + 120; x < W + lp; x += lp) {
    const pulse = 0.55 + 0.45 * Math.sin(t * 3 + x * 0.01);
    glow(ctx, x, 32, 130, "rgba(255,70,90,A)", 0.45 * pulse);
    rr(ctx, x - 13, 20, 26, 11, 5.5); ctx.fillStyle = `rgba(255,${90 + pulse * 60},110,1)`; ctx.fill();
  }
}

function labCorridor(ctx: Ctx, scroll: number, t: number): void {
  ctx.fillStyle = vgrad(ctx, 0, G, [[0, "#d9e7fa"], [1, "#a6c1e6"]]);
  ctx.fillRect(0, 0, W, H);
  const wp = 340, wo = (scroll * 0.35) % wp;
  for (let x = -wo; x < W + wp; x += wp) {
    ctx.save();
    rr(ctx, x + 40, 64, 210, 190, 26); ctx.clip();
    ctx.fillStyle = vgrad(ctx, 64, 254, [[0, "#14254e"], [1, "#5f86c4"]]); ctx.fillRect(x + 40, 64, 210, 190);
    ctx.fillStyle = "#cfe0ff";
    ctx.beginPath(); ctx.moveTo(x + 40, 254); ctx.quadraticCurveTo(x + 110, 140, x + 160, 204); ctx.quadraticCurveTo(x + 205, 150, x + 250, 254); ctx.closePath(); ctx.fill();
    ctx.restore();
    rr(ctx, x + 40, 64, 210, 190, 26); ctx.strokeStyle = "#f4f9ff"; ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 145, 68); ctx.lineTo(x + 145, 250); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(80,120,180,0.18)"; ctx.lineWidth = 2;
  const sp = 170, so = (scroll * 0.55) % sp;
  for (let x = -so; x < W + sp; x += sp) { ctx.beginPath(); ctx.moveTo(x, 36); ctx.lineTo(x, G); ctx.stroke(); }
  rr(ctx, -10, -10, W + 20, 42, 18); ctx.fillStyle = vgrad(ctx, -10, 32, [[0, "#eff6ff"], [1, "#b6cdea"]]); ctx.fill();
  const lp = 200, lo = (scroll * 0.9) % lp;
  for (let x = -lo; x < W + lp; x += lp) {
    glow(ctx, x + 55, 26, 120, "rgba(255,255,255,A)", 0.55);
    rr(ctx, x + 12, 15, 86, 11, 5.5); ctx.fillStyle = "#ffffff"; ctx.fill();
  }
}

function cargoBay(ctx: Ctx, scroll: number, t: number): void {
  ctx.fillStyle = vgrad(ctx, 0, G, [[0, "#191526"], [1, "#4d3b48"]]);
  ctx.fillRect(0, 0, W, H);
  const cols = ["#2e6f86", "#b4693a", "#58627a", "#7a4a5e"];
  const cp = 180, co = (scroll * 0.25) % cp;
  const i0 = Math.floor((scroll * 0.25) / cp) - 1;
  for (let x = -co - cp, i = i0; x < W + cp; x += cp, i++) {
    const n = 1 + (((i * 7 + 3) % 3) + 3) % 3;
    for (let k = 0; k < n; k++) {
      rr(ctx, x + 8, G - 24 - (k + 1) * 62, 140, 56, 10);
      ctx.fillStyle = cols[(((i + k + 8) % 4) + 4) % 4]; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  const gp = 340, go = (scroll * 0.6) % gp;
  for (let x = -go; x < W + gp; x += gp) {
    rr(ctx, x, 44, 20, G - 44, 10); ctx.fillStyle = "#2a2536"; ctx.fill();
    glow(ctx, x + 10, 70, 100, "rgba(255,170,70,A)", 0.45 * (0.7 + 0.3 * Math.sin(t * 2 + x)));
    rr(ctx, x + 3, 63, 14, 14, 7); ctx.fillStyle = "#ffbe6b"; ctx.fill();
  }
  rr(ctx, -10, 16, W + 20, 24, 12); ctx.fillStyle = "#2f2a3e"; ctx.fill();
}

function outside(ctx: Ctx, scroll: number, t: number, dawn: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, G);
  g.addColorStop(0, `rgb(${lerp(13, 70, dawn)},${lerp(27, 100, dawn)},${lerp(61, 160, dawn)})`);
  g.addColorStop(0.55, `rgb(${lerp(42, 190, dawn)},${lerp(74, 150, dawn)},${lerp(134, 170, dawn)})`);
  g.addColorStop(1, `rgb(${lerp(143, 255, dawn)},${lerp(191, 214, dawn)},${lerp(232, 190, dawn)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  glow(ctx, 650, 96, 140, "rgba(215,235,255,A)", 0.7 * (1 - dawn));
  glow(ctx, 540, G - 50, 300, "rgba(255,200,140,A)", 0.55 * dawn);
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 38; i++) {
    ctx.globalAlpha = (0.3 + 0.3 * Math.sin(t * 1.4 + i)) * (1 - dawn);
    ctx.beginPath(); ctx.arc((i * 211) % W, (i * 97) % 190, 1.3, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ridge(ctx, scroll * 0.06, 262, 130, 0.006, "#d8e8ff", "#4a6fae", 1);
  ridge(ctx, scroll * 0.14, 308, 100, 0.009, "#c9dcff", "#34568f", 7);
  ridge(ctx, scroll * 0.3, 352, 72, 0.013, "#bcd2f5", "#223d70", 13);
}

export function drawBackground(ctx: Ctx, stage: number, scroll: number, t: number, tickF: number): void {
  if (stage === 0) cellBlock(ctx, scroll, t);
  else if (stage === 1) labCorridor(ctx, scroll, t);
  else if (stage === 2) cargoBay(ctx, scroll, t);
  else outside(ctx, scroll, t, clamp((tickF - 450) / 150) * 0.85);
  floor(ctx, stage, scroll);
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.5, W / 2, H / 2, W * 0.72);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(3,8,22,0.42)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

// ---------- obstacles and enemies (x = left edge, width OB_W) ----------
function crate0(ctx: Ctx, x: number): void {
  const b = (bx: number, by: number, w: number, h: number) => {
    rr(ctx, bx, by, w, h, 7);
    ctx.fillStyle = vgrad(ctx, by, by + h, [[0, "#b7c9e6"], [1, "#6f86ad"]]); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1.5; ctx.stroke();
  };
  ctx.fillStyle = "rgba(10,20,45,0.3)";
  ctx.beginPath(); ctx.ellipse(x + OB_W / 2, G + 2, 28, 5, 0, 0, TAU); ctx.fill();
  b(x, G - 21, OB_W, 21);
  b(x + 6, G - 36, OB_W - 12, 16);
  rr(ctx, x + 9, G - 14, OB_W - 18, 5, 2.5); ctx.fillStyle = "#58e0ff"; ctx.fill();
  glow(ctx, x + OB_W / 2, G - 11, 30, "rgba(90,220,255,A)", 0.4);
}

// Ground obstacles are drawn large (like the big floor enemies in EMB). Scaling is visual only; hit boxes are unchanged.
export const CRATE_SCALE = 1.55;
function scaled(ctx: Ctx, x: number, k: number, draw: () => void): void {
  const cx = x + OB_W / 2;
  ctx.save();
  ctx.translate(cx, G); ctx.scale(k, k); ctx.translate(-cx, -G);
  draw();
  ctx.restore();
}
export function drawCrate(ctx: Ctx, x: number): void { scaled(ctx, x, CRATE_SCALE, () => crate0(ctx, x)); }
/** Guard: a tall armoured ground unit (about 175px) that cannot be jumped, so it has to be shot. */
export const GUARD_H = 175;
export function drawSentry(ctx: Ctx, x: number, t: number, hp: number, flash: number): void {
  const cx = x + OB_W / 2;
  const hurt = hp <= 1;
  ctx.save();
  ctx.fillStyle = "rgba(10,20,45,0.35)";
  ctx.beginPath(); ctx.ellipse(cx, G + 2, 52, 7, 0, 0, TAU); ctx.fill();
  // treads
  rr(ctx, cx - 46, G - 26, 92, 26, 13); ctx.fillStyle = "#1c2340"; ctx.fill();
  ctx.fillStyle = "#4b5a84";
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(cx - 36 + i * 14.4, G - 13, 5, 0, TAU); ctx.fill(); }
  // legs / hull
  rr(ctx, cx - 36, G - 96, 72, 76, 10); ctx.fillStyle = vgrad(ctx, G - 96, G - 20, [[0, "#b9c8e4"], [1, "#56668f"]]); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 2; ctx.stroke();
  // hazard stripes
  ctx.save(); rr(ctx, cx - 36, G - 56, 72, 14, 4); ctx.clip();
  for (let i = -2; i < 8; i++) { ctx.fillStyle = i % 2 ? "#ffb23a" : "#1c2340"; ctx.beginPath(); ctx.moveTo(cx - 40 + i * 14, G - 42); ctx.lineTo(cx - 26 + i * 14, G - 42); ctx.lineTo(cx - 12 + i * 14, G - 56); ctx.lineTo(cx - 26 + i * 14, G - 56); ctx.fill(); }
  ctx.restore();
  // chest + shoulders
  rr(ctx, cx - 44, G - 140, 88, 52, 14); ctx.fillStyle = vgrad(ctx, G - 140, G - 88, [[0, "#d3deF3"], [1, "#6c7ea8"]]); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.stroke();
  rr(ctx, cx - 22, G - 128, 44, 14, 7); ctx.fillStyle = hurt ? "#ff5a5a" : "#ff9a4d"; ctx.fill();
  glow(ctx, cx, G - 121, 46, "rgba(255,130,70,A)", 0.5 + Math.sin(t * 5) * 0.12);
  // head dome with visor
  ctx.beginPath(); ctx.arc(cx, G - 140, 24, Math.PI, 0); ctx.closePath();
  ctx.fillStyle = vgrad(ctx, G - 164, G - 140, [[0, "#e4ecfa"], [1, "#8fa1c7"]]); ctx.fill();
  const sc = Math.sin(t * 2.4 + x * 0.02) * 5;
  rr(ctx, cx - 18 + sc * 0.4, G - 156, 26, 9, 4.5); ctx.fillStyle = hurt ? "#ff3d3d" : "#ff7a3a"; ctx.fill();
  glow(ctx, cx - 5 + sc * 0.4, G - 151, 34, "rgba(255,110,60,A)", 0.6);
  // antenna
  ctx.strokeStyle = "#8fa1c7"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx + 12, G - 162); ctx.lineTo(cx + 16, G - 176); ctx.stroke();
  ctx.fillStyle = "#ff5a5a"; ctx.beginPath(); ctx.arc(cx + 16, G - 176, 3.5, 0, TAU); ctx.fill();
  // cannon arm pointing at the player
  rr(ctx, cx - 74, G - 118, 44, 16, 8); ctx.fillStyle = "#3a4668"; ctx.fill();
  rr(ctx, cx - 82, G - 114, 14, 8, 4); ctx.fillStyle = "#ff9a4d"; ctx.fill();
  // health pips
  for (let i = 0; i < 3; i++) { ctx.fillStyle = i < hp ? "#ffb27a" : "rgba(20,28,50,0.7)"; ctx.fillRect(cx - 21 + i * 15, G - 190, 12, 5); }
  if (hurt) {
    ctx.fillStyle = "rgba(60,70,90,0.5)";
    ctx.beginPath(); ctx.arc(cx + 22 + Math.sin(t * 6) * 3, G - 170 - ((t * 24) % 14), 5, 0, TAU); ctx.fill();
  }
  if (flash > 0) { rr(ctx, cx - 46, G - 166, 92, 166, 14); ctx.fillStyle = `rgba(255,255,255,${flash * 0.7})`; ctx.fill(); }
  ctx.restore();
}

export function drawDrone(ctx: Ctx, x: number, t: number, flash: number, danger: boolean): void {
  const cx = x + OB_W / 2;
  const cy = DRONE_Y + Math.sin(t * 3 + x * 0.03) * 4;
  const cg = ctx.createLinearGradient(0, cy + 14, 0, G - 60);
  cg.addColorStop(0, `rgba(255,90,100,${danger ? 0.26 : 0.12})`);
  cg.addColorStop(1, "rgba(255,90,100,0)");
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.moveTo(cx - 14, cy + 14); ctx.lineTo(cx + 14, cy + 14); ctx.lineTo(cx + 34, G - 60); ctx.lineTo(cx - 34, G - 60); ctx.closePath(); ctx.fill();
  for (const s of [-1, 1]) {
    rr(ctx, cx + s * 25 - 9, cy - 5, 18, 10, 5); ctx.fillStyle = "#3a4668"; ctx.fill();
    ctx.fillStyle = "rgba(200,225,255,0.35)";
    ctx.beginPath(); ctx.ellipse(cx + s * 25, cy - 8, 11 + Math.sin(t * 40) * 1.5, 2.2, 0, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = vgrad(ctx, cy - 20, cy + 20, [[0, "#d3def3"], [1, "#6a7ba3"]]);
  ctx.beginPath(); ctx.arc(cx, cy, 20, 0, TAU); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(cx, cy, 20, 7, 0, 0, TAU); ctx.stroke();
  ctx.fillStyle = "#1c2440"; ctx.beginPath(); ctx.arc(cx, cy, 9.5, 0, TAU); ctx.fill();
  const pulse = 0.7 + 0.3 * Math.sin(t * 5 + x);
  ctx.fillStyle = `rgba(255,${80 + pulse * 40},90,1)`; ctx.beginPath(); ctx.arc(cx, cy, 5.8, 0, TAU); ctx.fill();
  glow(ctx, cx, cy, 42, "rgba(255,80,100,A)", 0.5 * pulse);
  ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.beginPath(); ctx.arc(cx - 2, cy - 2, 1.9, 0, TAU); ctx.fill();
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.8})`; ctx.beginPath(); ctx.arc(cx, cy, 22, 0, TAU); ctx.fill(); }
}

export const enemyCenter = (kind: number, x: number): [number, number] =>
  kind === 2 ? [x + OB_W / 2, DRONE_Y] : [x + OB_W / 2, G - 118];

// ---------- the yeti: Subject Y-7 (original design) ----------
export type YetiPose = {
  t: number; air: boolean; dead: boolean; alpha?: number; ghost?: boolean; hurt?: number; firing?: number; idle?: boolean;
};

const FUR_L = "#f7faff", FUR_M = "#dce8f8", FUR_D = "#aec2e0", FUR_DD = "#7f98c3";

/** two-bone IK. returns the knee/elbow position; `bend` picks which way the joint folds. */
function ik(ax: number, ay: number, tx: number, ty: number, l1: number, l2: number, bend: number): [number, number, number, number] {
  let dx = tx - ax, dy = ty - ay;
  let d = Math.hypot(dx, dy);
  const max = l1 + l2 - 0.5;
  if (d > max) { const k = max / d; dx *= k; dy *= k; d = max; }
  const a = Math.atan2(dy, dx);
  const cosv = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * Math.max(d, 0.001)), -1, 1);
  const ang = Math.acos(cosv);
  return [ax + Math.cos(a + bend * ang) * l1, ay + Math.sin(a + bend * ang) * l1, ax + dx, ay + dy];
}

function limb(ctx: Ctx, pts: [number, number][], w: number, fill: string, edge: string): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = edge;
  ctx.lineWidth = w + 4;
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
  ctx.strokeStyle = fill;
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
}

/** shaggy joint: a few overlapping fur puffs so limbs never look like plain tubes */
function fluff(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.fillStyle = fill;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.4;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.55, 0, TAU); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, TAU); ctx.fill();
}

function shackle(ctx: Ctx, x: number, y: number, swing: number): void {
  rr(ctx, x - 8, y - 4.5, 16, 9, 4.5); ctx.fillStyle = vgrad(ctx, y - 5, y + 5, [[0, "#b9c4da"], [1, "#6e7b99"]]); ctx.fill();
  ctx.strokeStyle = "#cdd6e8"; ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(x + swing * (i + 1) * 1.5, y + 8 + i * 6, 2.8, 4, swing * 0.12, 0, TAU); ctx.stroke(); }
}

function blaster(ctx: Ctx, x: number, y: number, ang: number, fire: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  rr(ctx, 0, 1, 9, 15, 4); ctx.fillStyle = "#26324f"; ctx.fill(); // grip
  rr(ctx, -6, -9, 38, 14, 7); ctx.fillStyle = vgrad(ctx, -9, 5, [[0, "#f3f8ff"], [1, "#9db5da"]]); ctx.fill();
  rr(ctx, 4, -6, 20, 4, 2); ctx.fillStyle = "#58e0ff"; ctx.fill();
  rr(ctx, 28, -8, 10, 12, 5); ctx.fillStyle = "#3d4d78"; ctx.fill();
  if (fire > 0) glow(ctx, 40, -2, 30, "rgba(140,235,255,A)", fire);
  ctx.restore();
}

/** (x, y) = bottom-centre of the feet. Faces right. */
export function drawYeti(ctx: Ctx, x: number, y: number, p: YetiPose, sheet?: Sprites | null): void {
  if (sheet && sheet.ready && !p.ghost) { sheet.draw(ctx, x, y, p); return; }
  const t = p.t;
  const run = !p.air && !p.dead && !p.idle;
  const ph = t * 15;
  const s = Math.sin(ph), c = Math.cos(ph);
  const bob = run ? -Math.abs(s) * 3.5 : p.idle ? Math.sin(t * 2.2) * 1.4 : 0;
  const fire = p.firing ?? 0;
  const blink = p.hurt && Math.floor(t * 20) % 2 === 0 ? 0.4 : 1;

  ctx.save();
  ctx.globalAlpha = (p.alpha ?? 1) * blink;
  ctx.translate(x, y);
  ctx.scale(0.78, 0.78);
  if (p.dead) { ctx.translate(-10, 0); ctx.rotate(-1.15); }
  if (p.ghost) { ctx.shadowColor = "#7ff0ff"; ctx.shadowBlur = 18; }

  const UP = 9;
  const hipY = -50 + bob; // hips sit lower than the upper body so the knees stay bent
  const hipB = -7, hipF = 9;
  // feet
  let fb: [number, number], ff: [number, number];
  if (p.air) { fb = [hipB - 6, -28]; ff = [hipF + 12, -40]; }
  else if (p.idle) { fb = [hipB - 3, 0]; ff = [hipF + 3, 0]; }
  else {
    fb = [hipB + Math.sin(ph + Math.PI) * 20, -Math.max(0, Math.cos(ph + Math.PI)) * 15];
    ff = [hipF + s * 20, -Math.max(0, c) * 15];
  }
  const kb = ik(hipB, hipY, fb[0], fb[1], 30, 30, -1);
  const kf = ik(hipF, hipY, ff[0], ff[1], 30, 30, -1);

  const shY = -104 - UP + bob;
  // back arm
  const bh: [number, number] = p.air ? [-26, -100] : [-8 - s * 17, -80 - UP + bob + c * 6];
  const ba = ik(-9, shY, bh[0], bh[1], 24, 24, 1);
  limb(ctx, [[-9, shY], [ba[0], ba[1]], [ba[2], ba[3]]], 20, FUR_D, FUR_DD);
  fluff(ctx, ba[0], ba[1], 13, FUR_D);
  ctx.fillStyle = FUR_D; ctx.beginPath(); ctx.arc(ba[2], ba[3] + 2, 10, 0, TAU); ctx.fill();
  shackle(ctx, ba[2], ba[3] + 2, Math.sin(t * 14) * 2);

  // back leg
  limb(ctx, [[hipB, hipY], [kb[0], kb[1]], [kb[2], kb[3]]], 25, FUR_D, FUR_DD);
  fluff(ctx, kb[0], kb[1], 15, FUR_D);
  ctx.fillStyle = FUR_D; ctx.beginPath(); ctx.ellipse(kb[2] + 6, kb[3] - 3, 19, 10.5, 0, 0, TAU); ctx.fill();

  // torso
  const tg = vgrad(ctx, -127, -55, [[0, FUR_L], [1, FUR_M]]);
  cloud(ctx, 0, -80 - UP + bob, 35, 40, tg, 15);
  cloud(ctx, 0, -104 - UP + bob, 31, 17, FUR_L, 11); // shoulder mass
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath(); ctx.ellipse(9, -74 - UP + bob, 17, 22, 0.1, 0, TAU); ctx.fill();
  ctx.strokeStyle = "rgba(140,168,212,0.6)"; ctx.lineWidth = 2; ctx.lineCap = "round"; // fur strands
  for (let i = 0; i < 7; i++) {
    const fx = -26 + i * 8, fy = -86 - UP + (i % 3) * 9 + bob;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.quadraticCurveTo(fx - 4, fy + 8, fx - 1, fy + 16); ctx.stroke();
  }
  cloud(ctx, 0, -54 - UP + bob, 30, 16, FUR_M, 10); // hip fur
  // prisoner tag
  rr(ctx, 7, -82 - UP + bob, 17, 12, 4); ctx.fillStyle = "#cfd9ec"; ctx.fill();
  ctx.strokeStyle = "#8fa3c6"; ctx.lineWidth = 1; ctx.stroke();
  ctx.font = `8px ${PIXEL}`; ctx.fillStyle = "#33456d"; ctx.textAlign = "center"; ctx.fillText("Y7", 15.5, -73 - UP + bob);

  // front leg
  limb(ctx, [[hipF, hipY], [kf[0], kf[1]], [kf[2], kf[3]]], 27, FUR_M, FUR_D);
  fluff(ctx, kf[0], kf[1], 16, FUR_M);
  ctx.fillStyle = FUR_L; ctx.beginPath(); ctx.ellipse(kf[2] + 7, kf[3] - 3, 21, 11.5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#9fb4d6"; ctx.beginPath(); ctx.ellipse(kf[2] + 7, kf[3] + 4, 18, 3.4, 0, 0, TAU); ctx.fill();

  // scarf
  const wave = Math.sin(t * 12) * 3.5, wv2 = Math.sin(t * 12 + 1.3) * 4;
  const nx = 8, ny = -104 - UP + bob;
  ctx.fillStyle = "#e0561a";
  ctx.beginPath();
  ctx.moveTo(nx - 4, ny + 2);
  ctx.bezierCurveTo(nx - 26, ny + wave, nx - 48, ny + 6 + wv2, nx - 66, ny + 14 + wv2 * 1.5);
  ctx.bezierCurveTo(nx - 62, ny + 25 + wv2, nx - 36, ny + 18 + wave, nx - 2, ny + 11);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ff8a3d";
  ctx.beginPath();
  ctx.moveTo(nx - 4, ny - 1);
  ctx.bezierCurveTo(nx - 26, ny - 3 + wave, nx - 46, ny + 2 + wv2, nx - 62, ny + 8 + wv2 * 1.5);
  ctx.bezierCurveTo(nx - 44, ny + 11 + wave, nx - 24, ny + 8, nx - 2, ny + 7);
  ctx.closePath(); ctx.fill();
  rr(ctx, nx - 14, ny - 7, 34, 15, 7.5); ctx.fillStyle = vgrad(ctx, ny - 7, ny + 8, [[0, "#ff9a52"], [1, "#ff6a1a"]]); ctx.fill();

  // head
  const hx = 12, hy = -126 - UP + bob;
  ctx.fillStyle = FUR_D; ctx.beginPath(); ctx.arc(hx - 25, hy - 2, 8, 0, TAU); ctx.fill(); // ear
  cloud(ctx, hx, hy, 31, 28, vgrad(ctx, hy - 30, hy + 28, [[0, FUR_L], [1, FUR_M]]), 13);
  // brow tufts
  ctx.fillStyle = FUR_L;
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(hx - 12 + i * 8, hy - 28 + (i % 2) * 2, 5, 7.5, (i - 1.5) * 0.2, 0, TAU); ctx.fill(); }
  // face mask
  const mg = ctx.createLinearGradient(0, hy - 14, 0, hy + 20);
  mg.addColorStop(0, "#3d5b97"); mg.addColorStop(1, "#1f3159");
  ctx.fillStyle = mg;
  ctx.beginPath(); ctx.ellipse(hx + 7, hy + 3, 21, 18, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = "rgba(160,200,255,0.35)"; ctx.lineWidth = 1.5; ctx.stroke();
  // eyes
  const ex = [hx + 1, hx + 16];
  for (const e of ex) {
    glow(ctx, e, hy - 1, 15, "rgba(120,230,255,A)", 0.45);
    if (p.dead) {
      ctx.strokeStyle = "#cfefff"; ctx.lineWidth = 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(e - 3.5, hy - 5); ctx.lineTo(e + 3.5, hy + 2); ctx.moveTo(e + 3.5, hy - 5); ctx.lineTo(e - 3.5, hy + 2); ctx.stroke();
    } else {
      ctx.fillStyle = "#f4fbff"; ctx.beginPath(); ctx.ellipse(e, hy - 1, 5.6, 6.6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#59d8ff"; ctx.beginPath(); ctx.arc(e + 1.2, hy - 0.4, 3.7, 0, TAU); ctx.fill();
      ctx.fillStyle = "#0b1a38"; ctx.beginPath(); ctx.arc(e + 1.6, hy - 0.4, 1.9, 0, TAU); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(e + 0.2, hy - 2.6, 1.2, 0, TAU); ctx.fill();
    }
  }
  if (!p.dead) { // determined brows
    ctx.strokeStyle = "#0f1d3d"; ctx.lineWidth = 3.2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(hx - 5, hy - 10); ctx.lineTo(hx + 7, hy - 6.5); ctx.moveTo(hx + 10, hy - 6.5); ctx.lineTo(hx + 22, hy - 10.5); ctx.stroke();
  }
  // nose and mouth
  ctx.fillStyle = "#6f8cc2"; ctx.beginPath(); ctx.ellipse(hx + 9, hy + 6.5, 3.6, 2.5, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = "#0f1d3d"; ctx.lineWidth = 2; ctx.lineCap = "round";
  ctx.beginPath();
  if (p.dead) { ctx.moveTo(hx + 3, hy + 14); ctx.quadraticCurveTo(hx + 9, hy + 11, hx + 15, hy + 14); }
  else if (fire > 0 || p.air) ctx.ellipse(hx + 9, hy + 13, 3.6, 2.8, 0, 0, TAU);
  else { ctx.moveTo(hx + 3, hy + 12.5); ctx.quadraticCurveTo(hx + 9, hy + 16, hx + 15, hy + 12.5); }
  ctx.stroke();
  // beard fluff
  ctx.fillStyle = FUR_L;
  ctx.beginPath(); ctx.ellipse(hx + 8, hy + 22, 15, 7, 0, 0, TAU); ctx.ellipse(hx - 6, hy + 19, 8, 6, 0, 0, TAU); ctx.ellipse(hx + 22, hy + 19, 8, 6, 0, 0, TAU); ctx.fill();

  // front arm with blaster
  const fh: [number, number] = p.air ? [56, -112 + bob] : [54 + s * 2 - fire * 4, -98 - UP + 4 + bob - fire * 10 + c * 2];
  const fa = ik(11, shY, fh[0], fh[1], 26, 26, 1);
  limb(ctx, [[11, shY], [fa[0], fa[1]], [fa[2], fa[3]]], 21, FUR_L, FUR_D);
  fluff(ctx, fa[0], fa[1], 13, FUR_L);
  blaster(ctx, fa[2] - 3, fa[3] - 3, -0.08 - fire * 0.06, fire);
  ctx.fillStyle = FUR_L; ctx.beginPath(); ctx.arc(fa[2] + 1, fa[3], 11, 0, TAU); ctx.fill();

  ctx.restore();
}

// ---------- HUD ----------
export function metal(ctx: Ctx, x: number, y: number, w: number, h: number, r = 8): void {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = vgrad(ctx, y, y + h, [[0, "rgba(28,34,52,0.92)"], [1, "rgba(10,14,28,0.92)"]]);
  ctx.fill();
  ctx.strokeStyle = "rgba(170,200,255,0.30)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  rr(ctx, x + 2, y + 2, w - 4, h - 4, Math.max(2, r - 2));
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function drawPortrait(ctx: Ctx, x: number, y: number, size: number, hurt: boolean): void {
  rr(ctx, x, y, size, size, 8);
  ctx.fillStyle = vgrad(ctx, y, y + size, [[0, "#3a5b9c"], [1, "#14234a"]]);
  ctx.fill();
  ctx.save();
  rr(ctx, x, y, size, size, 8); ctx.clip();
  const cx = x + size / 2, cy = y + size * 0.56, r = size * 0.4;
  cloud(ctx, cx, cy, r * 1.05, r * 1.0, FUR_L, 11);
  ctx.fillStyle = "#2a4175";
  ctx.beginPath(); ctx.ellipse(cx + 1, cy + 1, r * 0.66, r * 0.58, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#59d8ff";
  ctx.beginPath(); ctx.arc(cx - r * 0.22, cy - r * 0.08, r * 0.12, 0, TAU); ctx.arc(cx + r * 0.3, cy - r * 0.08, r * 0.12, 0, TAU); ctx.fill();
  ctx.fillStyle = FUR_L;
  ctx.beginPath(); ctx.ellipse(cx + 1, cy + r * 0.62, r * 0.5, r * 0.2, 0, 0, TAU); ctx.fill();
  ctx.restore();
  rr(ctx, x, y, size, size, 8);
  ctx.strokeStyle = hurt ? "#ff6a7a" : "rgba(190,220,255,0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** segmented health bar */
export function segBar(ctx: Ctx, x: number, y: number, n: number, on: number, segW: number, segH: number, gap: number, flashHot: boolean): void {
  for (let i = 0; i < n; i++) {
    rr(ctx, x + i * (segW + gap), y, segW, segH, 3);
    if (i < on) ctx.fillStyle = flashHot ? "#ff8a9a" : vgrad(ctx, y, y + segH, [[0, "#9fe9ff"], [1, "#2f9ad8"]]);
    else ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fill();
  }
}

export function drawCrosshair(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r - 3, cy); ctx.lineTo(cx - r + 3, cy); ctx.moveTo(cx + r - 3, cy); ctx.lineTo(cx + r + 3, cy);
  ctx.moveTo(cx, cy - r - 3); ctx.lineTo(cx, cy - r + 3); ctx.moveTo(cx, cy + r - 3); ctx.lineTo(cx, cy + r + 3);
  ctx.stroke();
}
