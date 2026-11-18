"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import Providers from "./providers";
import Game from "@/components/Game";
import { PACKAGE_ID, LEADERBOARD_ID, RANDOM_ID, CLOCK_ID, MODULE } from "@/lib/config";
import { replay } from "@/lib/engine.ts";
import { audio } from "@/lib/audio.ts";
import { dailySeed, utcDay, msUntilNextDay, fmtCountdown } from "@/lib/daily.ts";
import { encodeGhost, parseGhost, loadBest, saveBest } from "@/lib/ghost.ts";

const explorer = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
type Tab = "daily" | "free";
type Session = { key: number; seed: bigint; runId: string | null; verified: boolean; ghost: number[] | null; label: string };
type Result = { jumps: number[]; score: number; newBest: boolean; localOk: boolean };
type Entry = { ok: boolean; msg: string; digest?: string };

function App() {
  const acct = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExec } = useSignAndExecuteTransaction();

  const [tab, setTab] = useState<Tab>("daily");
  const [session, setSession] = useState<Session | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [log, setLog] = useState<Entry[]>([]);
  const [board, setBoard] = useState<{ player: string; score: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [ghostCode, setGhostCode] = useState("");
  const [toast, setToast] = useState("");

  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const push = (e: Entry) => setLog((l) => [e, ...l]);
  const configured = !!(PACKAGE_ID && LEADERBOARD_ID);
  const day = now === null ? 0 : utcDay(now);

  useEffect(() => {
    setMuted(audio.muted);
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const loadBoard = useCallback(async () => {
    if (!LEADERBOARD_ID) return;
    const o = await client.getObject({ id: LEADERBOARD_ID, options: { showContent: true } });
    const f = (o.data?.content as any)?.fields?.entries ?? [];
    setBoard(f.map((e: any) => e.fields ?? e));
  }, [client]);
  useEffect(() => { loadBoard().catch(() => {}); }, [loadBoard]);

  const newSession = useCallback((seed: bigint, label: string, runId: string | null = null, verified = false) => {
    setResult(null);
    setSubmitted(false);
    setSession((s) => ({ key: (s?.key ?? 0) + 1, seed, runId, verified, ghost: loadBest(seed)?.jumps ?? null, label }));
  }, []);

  const practice = useCallback((t: Tab, d: number) => {
    if (t === "daily") newSession(dailySeed(d), `DAILY CHALLENGE · DAY ${d}`);
    else newSession(BigInt(Math.floor(Math.random() * 2147483648)), "FREE RUN · RANDOM SEED");
  }, [newSession]);

  // first session once the clock is known, and whenever the tab changes
  useEffect(() => { if (now !== null) practice(tab, utcDay(now)); /* eslint-disable-next-line */ }, [tab, now === null]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  const onDone = useCallback((jumps: number[], score: number) => {
    const s = sessionRef.current;
    if (!s) return;
    const newBest = saveBest(s.seed, score, jumps);
    setResult({ jumps, score, newBest, localOk: replay(s.seed, jumps) === score });
  }, []);

  const startVerified = async () => {
    setBusy(true);
    try {
      const tx = new Transaction();
      if (tab === "daily") tx.moveCall({ target: `${PACKAGE_ID}::${MODULE}::start_daily_run`, arguments: [tx.object(CLOCK_ID)] });
      else tx.moveCall({ target: `${PACKAGE_ID}::${MODULE}::start_run`, arguments: [tx.object(RANDOM_ID)] });
      const { digest } = await signAndExec({ transaction: tx });
      const r = await client.waitForTransaction({ digest, options: { showObjectChanges: true } });
      const created: any = r.objectChanges?.find((c: any) => c.type === "created" && c.objectType.endsWith(`::${MODULE}::Run`));
      const obj = await client.getObject({ id: created.objectId, options: { showContent: true } });
      const seed = BigInt((obj.data?.content as any).fields.seed);
      newSession(seed, tab === "daily" ? `VERIFIED DAILY · DAY ${day}` : "VERIFIED RUN · ON-CHAIN SEED", created.objectId, true);
      push({ ok: true, msg: tab === "daily" ? "Daily run started (seed derived on-chain from the date)" : "Run started, seed from sui::random", digest });
    } catch (e: any) { push({ ok: false, msg: `start failed: ${e.message}` }); }
    setBusy(false);
  };

  const submit = async (forge: boolean) => {
    if (!result || !session?.runId) return;
    setBusy(true);
    try {
      const claimed = forge ? result.score + 1000 : result.score;
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE}::submit_run`,
        arguments: [tx.object(LEADERBOARD_ID), tx.object(session.runId), tx.pure.vector("u16", result.jumps), tx.pure.u64(claimed)],
      });
      const { digest } = await signAndExec({ transaction: tx });
      const r = await client.waitForTransaction({ digest, options: { showEffects: true } });
      const ok = r.effects?.status.status === "success";
      push({ ok, msg: ok ? `Verified on-chain: score ${claimed}` : `REJECTED on-chain: ${r.effects?.status.error}`, digest });
      if (ok) { setSubmitted(true); setSession({ ...session, runId: null }); loadBoard(); }
    } catch (e: any) {
      // Wallets usually dry-run first, so a forged tx is refused with the Move abort before signing.
      push({ ok: false, msg: `REJECTED (${forge ? "forged" : "error"}): ${e.message}` });
    }
    setBusy(false);
  };

  const copy = async (text: string, msg: string) => {
    try { await navigator.clipboard.writeText(text); flash(msg); } catch { flash("Copy failed"); }
  };
  const copyBest = () => {
    if (!session) return;
    const b = loadBest(session.seed);
    if (!b) return flash("Play a run first");
    copy(encodeGhost(session.seed, b.jumps), "Ghost code copied");
  };
  const importGhost = () => {
    const g = parseGhost(ghostCode);
    if (!g) return flash("Invalid ghost code");
    saveBest(g.seed, g.score, g.jumps);
    newSession(BigInt(g.seed), `GHOST MATCH · TARGET ${g.score}`);
    setGhostCode("");
    flash(`Ghost loaded: ${g.score} (score re-computed locally)`);
  };

  const toggleMute = () => { audio.setMuted(!muted); setMuted(!muted); };
  const best = session ? loadBest(session.seed) : null;

  return (
    <main className="wrap">
      <div className="top">
        <div className="logo">
          <span style={{ fontSize: 26 }}>🏔️</span>
          <div>YETI PROOF-OF-RUN<small>Every score is replayed and verified on Sui.</small></div>
        </div>
        <div className="top-right">
          <button className="icon-btn" onClick={toggleMute} aria-label="Toggle sound" title="Sound">{muted ? "🔇" : "🔊"}</button>
          <ConnectButton />
        </div>
      </div>

      <section className="card">
        <div className="tabs">
          <button className={`tab ${tab === "daily" ? "on" : ""}`} onClick={() => setTab("daily")}>DAILY CHALLENGE</button>
          <button className={`tab ${tab === "free" ? "on" : ""}`} onClick={() => setTab("free")}>FREE RUN</button>
        </div>
        <div className="meta">
          {tab === "daily" && now !== null && (
            <>
              <span className="chip">Same course for everyone · day <b>{day}</b></span>
              <span className="chip">Resets in <b>{fmtCountdown(msUntilNextDay(now))}</b> UTC</span>
            </>
          )}
          {tab === "free" && <span className="chip">New random course every run</span>}
          {session && <span className="chip">Seed <b>{session.seed.toString()}</b></span>}
          <span className="chip">Your best on this seed <b>{best ? best.score : "—"}</b></span>
          {session?.ghost && <span className="chip" style={{ color: "#7ff0ff" }}>👻 Ghost racing your best</span>}
        </div>

        <div className="stage">
          {session && <Game key={session.key} seed={session.seed} ghost={session.ghost} label={session.label} onDone={onDone} />}
          {result && session && (
            <div className="result">
              <div className="result-card">
                <h2>RUN COMPLETE</h2>
                <div className="big">{result.score}</div>
                <div>
                  {result.newBest && <span className="badge gold">NEW BEST</span>}
                  <span className={`badge ${result.localOk ? "ok" : "bad"}`}>{result.localOk ? "REPLAY MATCH" : "REPLAY MISMATCH"}</span>
                  {session.verified && !submitted && <span className="badge ice">READY TO SUBMIT</span>}
                  {submitted && <span className="badge ok">VERIFIED ON-CHAIN</span>}
                </div>
                <div className="sub">{result.jumps.length} jumps logged · only the jump ticks are sent, the contract recomputes the score.</div>
                <div className="row">
                  <button className="btn" onClick={() => practice(tab, day)}>RUN AGAIN</button>
                  {session.verified && session.runId && (
                    <button className="btn warm" disabled={busy} onClick={() => submit(false)}>{busy ? "VERIFYING…" : "SUBMIT ON-CHAIN"}</button>
                  )}
                  <button className="btn ghost sm" onClick={copyBest}>COPY GHOST</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="bar">
          <button className="btn" onClick={() => practice(tab, day)} disabled={busy}>PRACTICE RUN</button>
          <button className="btn warm" onClick={startVerified} disabled={!acct || !configured || busy || (!!session?.runId && !result)}>
            {busy ? "WORKING…" : "VERIFIED RUN"}
          </button>
          <span className="note" style={{ margin: "auto 0", flex: 1, minWidth: 200 }}>
            Tap the game or press Space to start and jump. Practice is free; a verified run mints a Receipt and can reach the leaderboard.
          </span>
        </div>
        {!configured && <p className="warn" style={{ padding: "0 14px" }}>Set NEXT_PUBLIC_PACKAGE_ID and NEXT_PUBLIC_LEADERBOARD_ID to enable verified runs (see README). Practice works without a wallet.</p>}
      </section>

      <div className="grid">
        <section className="card pad">
          <h3>👻 GHOST RACING</h3>
          <p className="note">Your best run on a seed replays as a ghost next time you play that seed. Share a code and a friend can race your exact run; the score is re-computed locally, so a code can't lie.</p>
          <input className="field" placeholder="Paste a ghost code (YG1:…)" value={ghostCode} onChange={(e) => setGhostCode(e.target.value)} />
          <div className="row" style={{ justifyContent: "flex-start" }}>
            <button className="btn sm" onClick={importGhost} disabled={!ghostCode}>RACE THIS GHOST</button>
            <button className="btn ghost sm" onClick={copyBest}>COPY MY BEST</button>
          </div>
        </section>

        <section className="card pad">
          <h3>🏆 LEADERBOARD (VERIFIED)</h3>
          {board.length === 0 ? (
            <div className="empty">No verified runs yet. Be the first.</div>
          ) : (
            <ol className="lb">
              {board.map((b, i) => (
                <li key={i}><span className="rk">#{i + 1}</span><span>{String(b.player).slice(0, 8)}…{String(b.player).slice(-4)}</span><span className="sc">{b.score}</span></li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="card pad" style={{ marginTop: 14 }}>
        <h3>ACTIVITY</h3>
        <div className="log">
          {log.length === 0 && <div className="empty">Transactions show up here.</div>}
          {log.map((e, i) => (
            <div key={i} className={e.ok ? "ok" : "bad"}>
              {e.msg} {e.digest && <a href={explorer(e.digest)} target="_blank" rel="noreferrer">explorer</a>}
            </div>
          ))}
        </div>
        <details style={{ marginTop: 10 }}>
          <summary>Security demo</summary>
          <p className="note" style={{ marginTop: 8 }}>Submit a deliberately inflated score. The contract replays your log and aborts with E_SCORE_MISMATCH.</p>
          <button className="btn sm" style={{ background: "#e11d48", color: "#fff", boxShadow: "none" }} disabled={!result || !session?.runId || busy} onClick={() => submit(true)}>FORGE IT (SHOULD FAIL)</button>
        </details>
      </section>

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#0e1a3a", border: "1px solid var(--line)", padding: "10px 16px", borderRadius: 10, fontSize: 13 }}>{toast}</div>
      )}
    </main>
  );
}

export default function Page() { return <Providers><App /></Providers>; }
