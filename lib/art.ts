// Original vector art for the game (no external assets). Original yeti design:
// white fur, lavender-grey face, fur crest, and an orange scarf that trails in the wind.
export const W = 800;
export const H = 360;
export const GROUND = 292;
export const PX = 24; // pixels per sim tick
export const PLAYER_X = 150;
export const HSCALE = 4.2; // sim height unit -> pixels. Airborne min height (9 units) = 38px > crystal height (36px), so visuals match the engine rule.
export const CRYSTAL_W = 46; // 3 ticks of overlap = (CRYSTAL_W + 2*HIT_R) / PX
export const HIT_R = 13;
export const FONT = "'Press Start 2P', ui-monospace, Menlo, monospace";

type Ctx = CanvasRenderingContext2D;

export type Flake = { x: number; y: number; r: number; v: number; s: number };
export type Puff = { x: number; y: number; vx: number; vy: number; life: number };

export function newSnow(n = 70): Flake[] {
  return Array.from({ length: n }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: 0.8 + Math.random() * 2.2,
    v: 18 + Math.random() * 40,
    s: Math.random() * Math.PI * 2,
  }));
}

export function stepSnow(f: Flake[], dt: number, speed: number): void {
  for (const p of f) {
    p.y += p.v * dt;
    p.x -= (speed * 0.35 + 14 + p.r * 6) * dt;
    p.s += dt * 1.5;
    if (p.y > H) { p.y = -4; p.x = Math.random() * (W + 80); }
    if (p.x < -6) p.x = W + 6;
  }
}

export function drawSnow(ctx: Ctx, f: Flake[]): void {
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (const p of f) {
    ctx.globalAlpha = 0.35 + p.r / 4;
    ctx.beginPath();
    ctx.arc(p.x + Math.sin(p.s) * 6, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------- background ----------
function ridge(ctx: Ctx, scroll: number, base: number, amp: number, freq: number, fill: string, cap: string, seed: number) {
  ctx.beginPath();
  ctx.moveTo(0, H);
  const pts: [number, number][] = [];
  for (let x = 0; x <= W + 8; x += 8) {
    const u = (x + scroll) * freq + seed;
    const n = Math.abs(Math.sin(u) * 0.55 + Math.sin(u * 2.3 + 1.7) * 0.3 + Math.sin(u * 5.1 + 0.4) * 0.15);
    const y = base - n * amp;
    pts.push([x, y]);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  // snow caps on peaks
  ctx.fillStyle = cap;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    if (y < pts[i - 1][1] && y < pts[i + 1][1] && base - y > amp * 0.55) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 22, y + 26);
      ctx.lineTo(x - 8, y + 20);
      ctx.lineTo(x, y + 30);
      ctx.lineTo(x + 9, y + 20);
      ctx.lineTo(x + 24, y + 26);
      ctx.closePath();
      ctx.fill();
    }
  }
}

export function drawBackground(ctx: Ctx, scroll: number, t: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, "#0d1b3d");
  g.addColorStop(0.55, "#2a4a86");
  g.addColorStop(1, "#8fbfe8");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // moon glow
  const mg = ctx.createRadialGradient(640, 80, 4, 640, 80, 110);
  mg.addColorStop(0, "rgba(255,255,255,0.95)");
  mg.addColorStop(0.18, "rgba(210,232,255,0.55)");
  mg.addColorStop(1, "rgba(210,232,255,0)");
  ctx.fillStyle = mg;
  ctx.fillRect(500, 0, 300, 220);

  // stars
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 38; i++) {
    const x = (i * 211) % W;
    const y = (i * 97) % 150;
    ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 1.4 + i);
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;

  ridge(ctx, scroll * 0.06, 215, 110, 0.006, "#4a6fae", "rgba(255,255,255,0.8)", 1);
  ridge(ctx, scroll * 0.14, 250, 85, 0.009, "#34568f", "rgba(240,248,255,0.85)", 7);
  ridge(ctx, scroll * 0.3, 282, 60, 0.013, "#223d70", "rgba(235,245,255,0.9)", 13);
}

export function drawGround(ctx: Ctx, scroll: number): void {
  const g = ctx.createLinearGradient(0, GROUND, 0, H);
  g.addColorStop(0, "#f3f9ff");
  g.addColorStop(0.12, "#cfe4f8");
  g.addColorStop(1, "#7fa6d6");
  ctx.fillStyle = g;
  ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, GROUND, W, 4);
  // scrolling ice seams
  ctx.strokeStyle = "rgba(90,130,190,0.35)";
  ctx.lineWidth = 2;
  const gap = 64;
  const off = scroll % gap;
  for (let x = -off; x < W + gap; x += gap) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND + 4);
    ctx.lineTo(x - 22, H);
    ctx.stroke();
  }
}

// ---------- obstacle ----------
export function drawCrystal(ctx: Ctx, x: number): void {
  const w = CRYSTAL_W;
  const spikes: [number, number, number][] = [
    [0.2, 0.3, 26],
    [0.5, 0.42, 36],
    [0.8, 0.3, 24],
  ];
  for (const [cx, hw, h] of spikes) {
    const px = x + cx * w;
    const half = hw * 30;
    const g = ctx.createLinearGradient(px - half, GROUND - h, px + half, GROUND);
    g.addColorStop(0, "#e9fbff");
    g.addColorStop(0.5, "#78c8f0");
    g.addColorStop(1, "#2f7fc4");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(px - half, GROUND);
    ctx.lineTo(px - half * 0.6, GROUND - h * 0.7);
    ctx.lineTo(px, GROUND - h);
    ctx.lineTo(px + half * 0.7, GROUND - h * 0.68);
    ctx.lineTo(px + half, GROUND);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.moveTo(px - half * 0.2, GROUND - 4);
    ctx.lineTo(px, GROUND - h);
    ctx.lineTo(px - half * 0.55, GROUND - h * 0.55);
    ctx.closePath();
    ctx.fill();
  }
}

// ---------- the yeti ----------
export type YetiPose = { t: number; air: boolean; dead: boolean; alpha?: number; ghost?: boolean; vy?: number };

function fur(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, fill: string, tufts = 9) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i <= tufts * 2; i++) {
    const a = (i / (tufts * 2)) * Math.PI * 2;
    const k = i % 2 === 0 ? 1.0 : 0.9;
    const x = cx + Math.cos(a) * rx * k;
    const y = cy + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** (x, y) = bottom-center of the feet. */
export function drawYeti(ctx: Ctx, x: number, y: number, p: YetiPose): void {
  const run = Math.sin(p.t * 16);
  ctx.save();
  ctx.globalAlpha = p.alpha ?? 1;
  ctx.translate(x, y);
  if (p.dead) ctx.rotate(-0.9);
  if (p.ghost) ctx.shadowColor = "#7ff0ff", ctx.shadowBlur = 14;

  const FUR = "#f7fbff";
  const SHADE = "#c3d6ec";

  // back arm
  const armSwing = p.air ? -0.9 : run * 0.7;
  ctx.save();
  ctx.translate(-12, -36);
  ctx.rotate(-0.4 - armSwing * 0.6);
  fur(ctx, 0, 14, 8, 17, SHADE, 5);
  ctx.restore();

  // legs
  const l1 = p.air ? -6 : run * 9;
  const l2 = p.air ? 6 : -run * 9;
  fur(ctx, -9 + l1 * 0.4, -9 - (p.air ? 5 : Math.max(0, -run) * 4), 10, 10, SHADE, 6);
  fur(ctx, 10 + l2 * 0.4, -9 - (p.air ? 3 : Math.max(0, run) * 4), 10, 10, FUR, 6);
  ctx.fillStyle = "#9db6d6"; // soles
  ctx.fillRect(-18 + l1 * 0.4, -3, 18, 3);
  ctx.fillRect(1 + l2 * 0.4, -3, 18, 3);

  // body
  fur(ctx, 0, -38, 22, 26, FUR, 11);
  fur(ctx, 2, -28, 17, 15, "rgba(195,214,236,0.55)", 8);

  // scarf (trailing)
  const wave = Math.sin(p.t * 12) * 3;
  ctx.fillStyle = "#ff8a3d";
  ctx.beginPath();
  ctx.moveTo(-14, -58);
  ctx.quadraticCurveTo(-34, -58 + wave, -50, -52 + wave * 1.6);
  ctx.lineTo(-48, -44 + wave * 1.6);
  ctx.quadraticCurveTo(-30, -48 + wave, -12, -50);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ff6a1a";
  ctx.fillRect(-16, -62, 30, 9);

  // head
  fur(ctx, 4, -70, 19, 17, FUR, 9);
  // crest
  ctx.fillStyle = FUR;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-8 + i * 7, -84);
    ctx.lineTo(-4 + i * 7, -97 + (i % 2) * 3);
    ctx.lineTo(1 + i * 7, -84);
    ctx.fill();
  }
  // face
  ctx.fillStyle = "#c8d3e6";
  ctx.beginPath();
  ctx.ellipse(11, -68, 11, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  // eyes
  ctx.fillStyle = "#0f1a33";
  if (p.dead) {
    ctx.fillRect(7, -74, 6, 2);
    ctx.fillRect(15, -74, 6, 2);
  } else {
    ctx.beginPath();
    ctx.arc(9, -72, 3, 0, Math.PI * 2);
    ctx.arc(18, -72, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillRect(9, -74, 1.6, 1.6);
    ctx.fillRect(18, -74, 1.6, 1.6);
  }
  // brow + mouth
  ctx.strokeStyle = "#0f1a33";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(5, -78);
  ctx.lineTo(13, -76);
  ctx.moveTo(14, -76);
  ctx.lineTo(22, -78);
  ctx.stroke();
  ctx.beginPath();
  if (p.air) ctx.arc(14, -62, 3.5, 0, Math.PI * 2);
  else ctx.moveTo(9, -62), ctx.lineTo(18, -62);
  ctx.stroke();

  // front arm
  ctx.save();
  ctx.translate(14, -38);
  ctx.rotate(0.3 + armSwing * 0.6);
  fur(ctx, 0, 13, 8.5, 17, FUR, 5);
  ctx.restore();

  ctx.restore();
}

// ---------- effects ----------
export function stepPuffs(p: Puff[], dt: number): void {
  for (const q of p) {
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.vy += 60 * dt;
    q.life -= dt * 1.8;
  }
  for (let i = p.length - 1; i >= 0; i--) if (p[i].life <= 0) p.splice(i, 1);
}

export function spawnPuffs(p: Puff[], x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++)
    p.push({ x, y, vx: -40 - Math.random() * 90, vy: -20 - Math.random() * 40, life: 0.6 + Math.random() * 0.4 });
}

export function drawPuffs(ctx: Ctx, p: Puff[]): void {
  for (const q of p) {
    ctx.globalAlpha = Math.max(0, q.life) * 0.7;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(q.x, q.y, 2 + (1 - q.life) * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------- HUD ----------
export function panel(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = "rgba(10,20,48,0.72)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(160,205,255,0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

export function text(ctx: Ctx, s: string, x: number, y: number, size: number, color = "#eaf4ff", align: CanvasTextAlign = "left"): void {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillText(s, x + 2, y + 2);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}
