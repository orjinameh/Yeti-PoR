// Fully procedural audio (WebAudio): no asset files needed. Lo-fi loop + sfx.
// Must be started from a user gesture (call audio.unlock() inside a click/keydown/pointerdown).

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// Am7 | Fmaj7 | Cmaj7 | G6
const CHORDS = [
  { bass: 45, tones: [57, 60, 64, 67] },
  { bass: 41, tones: [57, 60, 64, 69] },
  { bass: 48, tones: [60, 64, 67, 71] },
  { bass: 43, tones: [59, 62, 64, 67] },
];
const ARP = [0, 2, 1, 3, 2, 3, 1, 2];
const BPM = 84;
const STEP = 60 / BPM / 2; // eighth note

class YetiAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  muted = false;

  constructor() {
    try {
      this.muted = typeof localStorage !== "undefined" && localStorage.getItem("yeti:muted") === "1";
    } catch {
      /* ignore */
    }
  }

  unlock(): void {
    if (!this.ctx) {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx: AudioContext = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 5200;
      this.master.connect(lp).connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.55;
      this.musicBus.connect(this.master);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.8;
      this.sfxBus.connect(this.master);
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem("yeti:muted", m ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  // ---------- music ----------
  startMusic(): void {
    if (!this.ctx || this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.step = 0;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.1);
    this.timer = setInterval(() => {
      if (!this.ctx) return;
      while (this.nextTime < this.ctx.currentTime + 0.2) {
        this.scheduleStep(this.step, this.nextTime);
        this.nextTime += STEP;
        this.step++;
      }
    }, 40);
  }

  stopMusic(fade = 0.4): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
  }

  private scheduleStep(n: number, t0: number): void {
    const bar = Math.floor(n / 8) % CHORDS.length;
    const s = n % 8;
    const ch = CHORDS[bar];
    const t = t0 + (s % 2 === 1 ? 0.028 : 0); // lazy swing
    if (s === 0) this.pad(ch.tones, t, STEP * 8);
    if (s === 0 || s === 4) this.voice("sine", mtof(ch.bass - 12), t, STEP * 3.2, 0.2, this.musicBus);
    if (s === 0 || s === 5) this.kick(t);
    if (s === 2 || s === 6) this.snare(t);
    if (s % 2 === 1) this.hat(t);
    const note = ch.tones[ARP[s]] + (s === 7 ? 12 : 0);
    this.voice("triangle", mtof(note), t, STEP * 1.8, 0.1, this.musicBus);
  }

  private pad(tones: number[], t: number, dur: number): void {
    if (!this.ctx) return;
    for (const m of tones) {
      for (const det of [-6, 6]) {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = "sine";
        o.frequency.value = mtof(m - 12);
        o.detune.value = det;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.028, t + 0.5);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.musicBus);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  private voice(type: OscillatorType, f: number, t: number, dur: number, vol: number, dest: AudioNode): void {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number): void {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.25);
  }

  private noiseHit(t: number, dur: number, vol: number, hp: number, dest: AudioNode): void {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
  private snare(t: number): void { this.noiseHit(t, 0.14, 0.16, 1500, this.musicBus); }
  private hat(t: number): void { this.noiseHit(t, 0.04, 0.07, 7000, this.musicBus); }

  // ---------- sfx ----------
  private sweep(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  jump(): void { this.sweep("square", 260, 640, 0.16, 0.12); }
  land(): void { if (this.ctx) this.noiseHit(this.ctx.currentTime, 0.07, 0.12, 900, this.sfxBus); }
  score(): void { this.sweep("triangle", 880, 880, 0.09, 0.14); this.sweep("triangle", 1320, 1320, 0.14, 0.12, 0.07); }
  start(): void { this.sweep("square", 330, 330, 0.08, 0.1); this.sweep("square", 495, 495, 0.08, 0.1, 0.08); this.sweep("square", 660, 660, 0.16, 0.1, 0.16); }
  die(): void {
    this.sweep("sawtooth", 360, 55, 0.5, 0.2);
    if (this.ctx) this.noiseHit(this.ctx.currentTime, 0.3, 0.2, 400, this.sfxBus);
  }
  win(): void { [523, 659, 784, 1047].forEach((f, i) => this.sweep("triangle", f, f, 0.22, 0.14, i * 0.1)); }
}

export const audio = new YetiAudio();
