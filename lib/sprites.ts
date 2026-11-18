// Optional sprite-sheet hook for the player character.
//
// Drop your own artwork at  public/sprites/yeti.png  (a single horizontal strip, every frame the same size,
// transparent background, character facing right, feet touching the bottom edge, centred horizontally)
// and describe it in SHEET below. If the file is missing the built-in vector yeti is used, so nothing breaks.
//
// Frame order in the strip (change the indexes in SHEET if yours differs):
//   0-7 run cycle, 8 jump, 9 fire (arm raised), 10 hurt, 11 dead (idle uses frame 0).
export const SHEET = {
  src: "/sprites/yeti.png",
  frameW: 256,
  frameH: 256,
  run: [0, 1, 2, 3, 4, 5, 6, 7],
  jump: 8,
  fire: 9,
  hurt: 10,
  dead: 11,
  drawH: 130, // on-screen height in world pixels (the world is 800x450)
  runFps: 14,
};

type Pose = { t: number; air: boolean; dead: boolean; alpha?: number; hurt?: number; firing?: number; idle?: boolean };

export class Sprites {
  ready = false;
  private img: HTMLImageElement | null = null;

  constructor() {
    if (typeof Image === "undefined") return;
    const img = new Image();
    img.onload = () => { this.img = img; this.ready = img.naturalWidth >= SHEET.frameW; };
    img.onerror = () => { this.ready = false; };
    img.src = SHEET.src;
  }

  draw(ctx: CanvasRenderingContext2D, x: number, y: number, p: Pose): void {
    if (!this.img) return;
    let f: number;
    if (p.dead) f = SHEET.dead;
    else if ((p.hurt ?? 0) > 0.5) f = SHEET.hurt;
    else if (p.air) f = SHEET.jump;
    else if ((p.firing ?? 0) > 0.3) f = SHEET.fire;
    else if (p.idle) f = SHEET.run[0];
    else f = SHEET.run[Math.floor(p.t * SHEET.runFps) % SHEET.run.length];
    const k = SHEET.drawH / SHEET.frameH;
    const w = SHEET.frameW * k, h = SHEET.frameH * k;
    ctx.save();
    ctx.globalAlpha = p.alpha ?? 1;
    ctx.drawImage(this.img, f * SHEET.frameW, 0, SHEET.frameW, SHEET.frameH, x - w / 2, y - h, w, h);
    ctx.restore();
  }
}
