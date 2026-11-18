// Daily challenge seed. MUST match `daily_seed` in move/sources/proof_of_run.move.
const M = 2147483648n;
const DAY_MS = 86_400_000;

export function utcDay(now: number = Date.now()): number {
  return Math.floor(now / DAY_MS);
}

export function dailySeed(day: number): bigint {
  return (BigInt(day) * 2654435761n + 40503n) % M;
}

export function msUntilNextDay(now: number = Date.now()): number {
  return (utcDay(now) + 1) * DAY_MS - now;
}

export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}
