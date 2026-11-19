// Local run history. Every finished run is kept on this device with its input log, so any run can be turned
// back into a ghost code (YG2:...) and copied, shared or raced. Verified runs also keep their tx digest.
import { encodeGhost } from "./ghost.ts";

export type RunRecord = {
  id: string; t: number; seed: string; score: number; jumps: number[]; shots: number[]; ticks: number;
  mode: "daily" | "free"; verified: boolean; digest?: string;
};

const KEY = "yeti:history1";
const MAX = 40;

export function loadHistory(): RunRecord[] {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(a) ? (a as RunRecord[]).filter((r) => r && Array.isArray(r.jumps) && Array.isArray(r.shots)) : [];
  } catch {
    return [];
  }
}

function save(list: RunRecord[]): void {
  for (const n of [MAX, 20, 8, 3]) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, n))); return; } catch { /* quota: keep fewer runs */ }
  }
}

export function addRun(r: Omit<RunRecord, "id" | "t" | "verified">): string {
  const rec: RunRecord = { ...r, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, t: Date.now(), verified: false };
  save([rec, ...loadHistory()]);
  return rec.id;
}

export function markVerified(id: string | null, digest: string): void {
  if (!id) return;
  save(loadHistory().map((r) => (r.id === id ? { ...r, verified: true, digest } : r)));
}

export const bestRun = (list: RunRecord[]): RunRecord | null => list.reduce<RunRecord | null>((b, r) => (!b || r.score > b.score ? r : b), null);

export const ghostOf = (r: RunRecord): string => encodeGhost(BigInt(r.seed), r.jumps, r.shots);

/** A link that opens the game with the ghost ready to race. Null when the code is too long for a URL. */
export function shareLink(code: string): string | null {
  if (code.length > 6000 || typeof window === "undefined") return null;
  return `${window.location.origin}${window.location.pathname}?g=${encodeURIComponent(code)}`;
}

/** Accepts a bare ghost code or a whole share link. */
export function extractCode(s: string): string {
  const m = /[?&]g=([^&\s#]+)/.exec(s);
  try { return (m ? decodeURIComponent(m[1]) : s).trim(); } catch { return s.trim(); }
}
