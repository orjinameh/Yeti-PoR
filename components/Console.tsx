"use client";
import { PointerEvent as RPointerEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ConnectModal, useCurrentAccount, useDisconnectWallet, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import Game, { Done, Ghost } from "./Game";
import { Icon, Mark } from "./icons";
import type { Runner } from "@/lib/runner.ts";
import { PACKAGE_ID, LEADERBOARD_ID, REGISTRY_ID, RANDOM_ID, CLOCK_ID, MODULE } from "@/lib/config";
import { replay } from "@/lib/engine.ts";
import { audio } from "@/lib/audio.ts";
import { dailySeed, utcDay, msUntilNextDay, fmtCountdown } from "@/lib/daily.ts";
import { encodeGhost, parseGhost, loadBest, saveBest } from "@/lib/ghost.ts";
import { STAGES } from "@/lib/art.ts";

type Screen = "boot" | "story" | "title" | "loading" | "run" | "pause" | "result" | "board" | "ghost";
type Mode = "daily" | "free";
type Session = { key: number; seed: bigint; runId: string | null; verified: boolean; ghost: Ghost | null; label: string };
type Result = Done & { newBest: boolean; localOk: boolean };
type Entry = { ok: boolean; msg: string; digest?: string };
type Row = { player: string; score: string };
type Tab = "all" | "today" | "season";

const explorer = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
// public fullnodes rate-limit and Safari reports that as "Load failed", so retry reads with backoff
async function retry<T>(fn: () => Promise<T>, tries = 6, ms = 700): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, ms * (i + 1))); }
  }
  throw last;
}
const TIPS = [
  "Hold FIRE to auto-aim. Shots have a short cooldown.",
  "Crates cannot be shot. Jump them.",
  "Drones only hurt you in the air. Stay low or shoot them.",
  "Clearing a stage with health left adds to your score.",
  "Your best run on a seed comes back as a ghost.",
];
const STORY = [
  "HALCYON STATION.\nSUBJECT Y-7 HAS BEEN IN CELL 7 FOR 400 DAYS.",
  "NOBODY KNOWS WHAT HE IS.\nNOBODY ASKED IF HE WANTED TO STAY.",
  "TONIGHT, THE LOCK FAILS.\nRUN.",
];
const JUMP_KEYS = new Set(["Space", "ArrowUp", "KeyW"]);
const FIRE_KEYS = new Set(["KeyF", "KeyJ", "KeyK", "ArrowRight", "KeyD"]);

function Key({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <button className={`key ${active ? "lit" : ""}`} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <span className="ico">{children}</span>
    </button>
  );
}

export default function Console() {
  const acct = useCurrentAccount();
  const client = useSuiClient();
  // Re-sending an already signed transaction is idempotent (same digest), so a dropped request ("Load failed") is safe to retry.
  const { mutateAsync: signAndExec } = useSignAndExecuteTransaction({
    execute: async ({ bytes, signature }) =>
      await retry(() => client.executeTransactionBlock({ transactionBlock: bytes, signature, options: { showRawEffects: true, showObjectChanges: true, showEffects: true } })),
  });
  const { mutate: disconnect } = useDisconnectWallet();

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => { try { setIsMobile(/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)); } catch {} }, []);
  const [screen, setScreen] = useState<Screen>("boot");
  const [back, setBack] = useState<Screen>("title");
  const [bootStep, setBootStep] = useState(0);
  const [bootPct, setBootPct] = useState(0);
  const [story, setStory] = useState(0);
  const [mode, setMode] = useState<Mode>("daily");
  const [session, setSession] = useState<Session | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [log, setLog] = useState<Entry[]>([]);
  const [board, setBoard] = useState<Row[]>([]);
  const [dayRows, setDayRows] = useState<Row[]>([]);
  const [seasonRows, setSeasonRows] = useState<Row[]>([]);
  const [myPoints, setMyPoints] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [busy, setBusy] = useState(false);
  const [sfxOn, setSfxOn] = useState(true);
  const [musicOn, setMusicOn] = useState(true);
  const [now, setNow] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [ghostCode, setGhostCode] = useState("");
  const [loadPct, setLoadPct] = useState(0);
  const [loadMsg, setLoadMsg] = useState("");
  const [tip, setTip] = useState(0);
  const [seenStory, setSeenStory] = useState(true);
  const [tutDone, setTutDone] = useState(true);
  const [padJump, setPadJump] = useState(false);
  const [padFire, setPadFire] = useState(false);
  const [, bump] = useState(0);

  const runnerRef = useRef<Runner | null>(null);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const st = useRef({ screen, bootStep, story, seenStory, mode, back });
  st.current = { screen, bootStep, story, seenStory, mode, back };
  const act = useRef<Record<string, () => void>>({});
  const configured = !!(PACKAGE_ID && LEADERBOARD_ID);
  const day = now === null ? 0 : utcDay(now);

  const push = (e: Entry) => setLog((l) => [e, ...l].slice(0, 6));
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2400); };

  // ---------- boot ----------
  useEffect(() => {
    setNow(Date.now());
    setSfxOn(!audio.sfxMuted);
    setMusicOn(!audio.musicMuted);
    try {
      setSeenStory(localStorage.getItem("yeti:story") === "1");
      setTutDone(localStorage.getItem("yeti:tut") === "1");
    } catch { /* ignore */ }
    const t = setTimeout(() => setBootStep(1), 1800);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (bootStep !== 1) return;
    let raf = 0, fontsOk = false, finished = false;
    const t0 = performance.now();
    const fonts = (document as any).fonts;
    const ready = fonts?.load
      ? Promise.all([fonts.load("12px Silkscreen"), fonts.load("700 12px 'Space Grotesk'")]).catch(() => {})
      : Promise.resolve();
    Promise.resolve(ready).then(() => { fontsOk = true; });
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / 2800);
      const eased = 1 - Math.pow(1 - k, 2.2);
      setBootPct(k >= 1 && !fontsOk ? 0.97 : eased);
      if (k >= 1 && fontsOk && !finished) { finished = true; setBootStep(2); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const tp = setInterval(() => setTip((n) => (n + 1) % TIPS.length), 1500);
    return () => { cancelAnimationFrame(raf); clearInterval(tp); };
  }, [bootStep]);

  useEffect(() => {
    if (screen !== "title") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [screen]);

  // ---------- sessions ----------
  const newSession = useCallback((seed: bigint, label: string, runId: string | null = null, verified = false) => {
    setSession((s) => ({ key: (s?.key ?? 0) + 1, seed, runId, verified, ghost: loadBest(seed) ?? null, label }));
  }, []);

  const attract = useCallback((m: Mode, d: number) => {
    if (m === "daily") newSession(dailySeed(d), `DAILY CHALLENGE - DAY ${d}`);
    else newSession(BigInt(Math.floor(Math.random() * 2147483648)), "FREE RUN");
  }, [newSession]);

  useEffect(() => {
    if (now !== null && !sessionRef.current) attract(mode, utcDay(now));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now === null]);

  // menu music
  useEffect(() => {
    if (["title", "story", "board", "ghost", "result"].includes(screen) && !audio.musicPlaying && bootStep === 2 && st.current.screen !== "boot") {
      audio.unlock();
      audio.startMusic();
    }
  }, [screen, bootStep]);

  // ---------- loading screen ----------
  const fill = (ms: number, from = 0) => new Promise<void>((res) => {
    const t0 = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      setLoadPct(from + (1 - from) * (1 - Math.pow(1 - k, 1.8)));
      if (k < 1) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });

  const launch = async (verified: boolean) => {
    audio.unlock();
    audio.click();
    setResult(null);
    setSubmitted(false);
    setLoadPct(0);
    setTip(Math.floor(Math.random() * TIPS.length));
    setScreen("loading");
    const m = st.current.mode;
    const d = utcDay(Date.now());
    if (verified) {
      setLoadMsg("CONFIRM THE TRANSACTION IN YOUR WALLET");
      setLoadPct(0.12);
      let step = "building transaction";
      try {
        const tx = new Transaction();
        if (m === "daily") tx.moveCall({ target: `${PACKAGE_ID}::${MODULE}::start_daily_run`, arguments: [tx.object(CLOCK_ID)] });
        else tx.moveCall({ target: `${PACKAGE_ID}::${MODULE}::start_run`, arguments: [tx.object(RANDOM_ID)] });
        step = "wallet signing";
        const { digest } = await signAndExec({ transaction: tx as any });
        setLoadMsg("WAITING FOR THE CHAIN");
        step = "confirming transaction";
        const r = await retry(() => client.waitForTransaction({ digest, timeout: 30000, pollInterval: 1000, options: { showObjectChanges: true, showEffects: true } }));
        if (r.effects?.status.status !== "success") throw new Error(`Transaction failed on-chain: ${r.effects?.status.error ?? "unknown error"}`);
        const created: any = r.objectChanges?.find((c: any) => c.type === "created" && c.objectType.endsWith(`::${MODULE}::Run`));
        if (!created) throw new Error(`Run object not found in the transaction. Check NEXT_PUBLIC_PACKAGE_ID matches the published package.`);
        // the fullnode can lag a moment behind the wallet's node, so retry the read
        step = "reading the new run";
        let obj: any = null;
        for (let i = 0; i < 6; i++) {
          obj = await retry(() => client.getObject({ id: created.objectId, options: { showContent: true } }));
          if (obj?.data?.content) break;
          await new Promise((res) => setTimeout(res, 600));
        }
        if (!obj?.data?.content) throw new Error("Run object was created but could not be read yet. Try again.");
        const seed = BigInt((obj.data.content as any).fields.seed);
        newSession(seed, m === "daily" ? `VERIFIED DAILY - DAY ${d}` : "VERIFIED RUN", created.objectId, true);
        push({ ok: true, msg: m === "daily" ? "Daily run started. Seed derived on-chain from the date." : "Run started. Seed from sui::random.", digest });
        setLoadMsg("SEED LOCKED");
        await fill(900, 0.12);
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        const rejected = /reject|denied|declin|cancel|closed/i.test(msg);
        const net = /load failed|failed to fetch|networkerror|429|timeout/i.test(msg);
        push({ ok: false, msg: rejected ? "Wallet request was rejected or closed." : `Could not start a verified run (${step}): ${msg}${net ? ". Network/RPC problem, your transaction may have gone through. Check your wallet activity, then try again." : ""}` });
        flash(rejected ? "Verified run cancelled" : "Verified run failed - see log");
        setScreen("title");
        return;
      }
    } else {
      attract(m, d);
      setLoadMsg(m === "daily" ? "SYNCING TODAY'S COURSE" : "GENERATING COURSE");
      await fill(1700);
    }
    setScreen("run");
    setTimeout(() => runnerRef.current?.start(), 60);
  };

  const onDone = useCallback((d: Done) => {
    const s = sessionRef.current;
    if (!s) return;
    const newBest = saveBest(s.seed, d.score, d.jumps, d.shots);
    setResult({ ...d, newBest, localOk: replay(s.seed, d.jumps, d.shots) === d.score });
    try { localStorage.setItem("yeti:tut", "1"); } catch { /* ignore */ }
    setTutDone(true);
    setScreen("result");
  }, []);

  const submit = async (forge: boolean) => {
    const s = sessionRef.current;
    if (!result || !s?.runId) return;
    setBusy(true);
    try {
      const claimed = forge ? result.score + 1000 : result.score;
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE}::submit_run`,
        arguments: [tx.object(LEADERBOARD_ID), tx.object(REGISTRY_ID), tx.object(s.runId), tx.pure.vector("u16", result.jumps), tx.pure.vector("u16", result.shots), tx.pure.u64(claimed)],
      });
      const { digest } = await signAndExec({ transaction: tx as any });
      const r = await client.waitForTransaction({ digest, options: { showEffects: true } });
      const ok = r.effects?.status.status === "success";
      push({ ok, msg: ok ? `Verified on-chain. Score ${claimed}.` : `Rejected on-chain: ${r.effects?.status.error}`, digest });
      if (ok) { setSubmitted(true); setSession({ ...s, runId: null }); audio.win(); loadBoard(); }
    } catch (e: any) {
      // wallets usually dry-run first, so a forged tx is refused with the Move abort before signing
      push({ ok: false, msg: `Rejected${forge ? " (forged score)" : ""}: ${e?.message ?? e}` });
    }
    setBusy(false);
  };

  const loadBoard = useCallback(async () => {
    if (!LEADERBOARD_ID) return;
    try {
      const o = await client.getObject({ id: LEADERBOARD_ID, options: { showContent: true } });
      const f = (o.data?.content as any)?.fields?.entries ?? [];
      setBoard(f.map((e: any) => e.fields ?? e));
    } catch { /* ignore */ }
    if (!REGISTRY_ID) return;
    try {
      const reg = await client.getObject({ id: REGISTRY_ID, options: { showContent: true } });
      const rf = (reg.data?.content as any)?.fields;
      const daysId = rf?.days?.fields?.id?.id;
      const seasonId = rf?.season?.fields?.id?.id;
      const profId = rf?.profiles?.fields?.id?.id;
      if (profId && acct) {
        try {
          const pr = await client.getDynamicFieldObject({ parentId: profId, name: { type: "address", value: acct.address } });
          setMyPoints(Number((pr.data?.content as any)?.fields?.value?.fields?.points ?? 0));
        } catch { setMyPoints(0); }
      } else setMyPoints(null);
      if (daysId) {
        try {
          const d = await client.getDynamicFieldObject({ parentId: daysId, name: { type: "u64", value: String(utcDay(Date.now())) } });
          const ents = (d.data?.content as any)?.fields?.value?.fields?.entries ?? [];
          setDayRows(ents.map((e: any) => e.fields ?? e));
        } catch { setDayRows([]); }
      }
      if (seasonId) {
        const list = await client.getDynamicFields({ parentId: seasonId });
        const objs = await client.multiGetObjects({ ids: list.data.map((x: any) => x.objectId), options: { showContent: true } });
        const rows = objs.map((o: any) => ({ player: String(o.data?.content?.fields?.name), score: String(o.data?.content?.fields?.value) }));
        rows.sort((x: Row, y: Row) => Number(y.score) - Number(x.score));
        setSeasonRows(rows.slice(0, 10));
      }
    } catch { /* ignore */ }
  }, [client, acct]);

  const redeem = async (kind: number, name: string) => {
    if (!REGISTRY_ID) return;
    setBusy(true);
    try {
      const tx = new Transaction();
      tx.moveCall({ target: `${PACKAGE_ID}::${MODULE}::redeem`, arguments: [tx.object(REGISTRY_ID), tx.pure.u8(kind)] });
      const { digest } = await signAndExec({ transaction: tx as any });
      await client.waitForTransaction({ digest });
      push({ ok: true, msg: `${name} added to your wallet.`, digest });
      flash(`${name} unlocked`);
      loadBoard();
    } catch (e: any) {
      flash("Not enough points, or sold out");
      push({ ok: false, msg: `Redeem failed: ${e?.message ?? e}` });
    }
    setBusy(false);
  };

  const finalizeYesterday = async () => {
    if (!REGISTRY_ID) return;
    setBusy(true);
    try {
      const tx = new Transaction();
      tx.moveCall({ target: `${PACKAGE_ID}::${MODULE}::finalize_day`, arguments: [tx.object(REGISTRY_ID), tx.object(CLOCK_ID), tx.pure.u64(utcDay(Date.now()) - 1)] });
      const { digest } = await signAndExec({ transaction: tx as any });
      await client.waitForTransaction({ digest });
      push({ ok: true, msg: "Yesterday finalized. Points awarded and the winner received a Trophy.", digest });
      flash("Day finalized");
      loadBoard();
    } catch (e: any) {
      flash("Nothing to finalize (no runs yesterday, or already finalized)");
      push({ ok: false, msg: `Finalize failed: ${e?.message ?? e}` });
    }
    setBusy(false);
  };

  // ---------- navigation ----------
  const open = (to: "board" | "ghost") => {
    audio.unlock(); audio.click();
    setBack(st.current.screen === "result" ? "result" : "title");
    if (to === "board") loadBoard();
    setScreen(to);
  };
  const goTitle = () => {
    audio.click();
    attract(st.current.mode, utcDay(Date.now()));
    setScreen("title");
  };
  const pauseRun = () => {
    const r = runnerRef.current;
    if (!r || (r.phase !== "play" && r.phase !== "count")) return;
    r.pause(); r.fire(false);
    audio.stopMusic(0.2);
    audio.click();
    setScreen("pause");
  };
  const resumeRun = () => {
    audio.click();
    runnerRef.current?.resume();
    audio.startMusic();
    setScreen("run");
  };
  const toggleMode = () => {
    audio.click();
    const m: Mode = st.current.mode === "daily" ? "free" : "daily";
    setMode(m);
    st.current.mode = m;
    attract(m, utcDay(Date.now()));
  };
  const pressStart = () => {
    audio.unlock(); audio.click(); audio.startMusic();
    if (st.current.seenStory) setScreen("title");
    else { setStory(0); setScreen("story"); }
  };
  const nextStory = () => {
    audio.click();
    if (st.current.story >= STORY.length - 1) {
      try { localStorage.setItem("yeti:story", "1"); } catch { /* ignore */ }
      setSeenStory(true);
      setScreen("title");
    } else setStory((n) => n + 1);
  };
  const skipStory = () => {
    try { localStorage.setItem("yeti:story", "1"); } catch { /* ignore */ }
    setSeenStory(true);
    audio.click();
    setScreen("title");
  };

  // ---------- ghost ----------
  const copy = async (text: string, msg: string) => {
    try { await navigator.clipboard.writeText(text); flash(msg); } catch { flash("Copy failed"); }
  };
  const copyBest = () => {
    const s = sessionRef.current;
    if (!s) return;
    const b = loadBest(s.seed);
    if (!b) return flash("Finish a run on this seed first");
    copy(encodeGhost(s.seed, b.jumps, b.shots), "Ghost code copied");
  };
  const importGhost = () => {
    const g = parseGhost(ghostCode);
    if (!g) return flash("That ghost code is not valid");
    saveBest(g.seed, g.score, g.jumps, g.shots);
    newSession(BigInt(g.seed), `GHOST MATCH - TARGET ${g.score}`);
    setGhostCode("");
    flash(`Ghost loaded. Score ${g.score} re-computed locally.`);
    setScreen("title");
  };

  // ---------- sound keys ----------
  const toggleSfx = () => { const v = !sfxOn; audio.unlock(); audio.setSfxMuted(!v); setSfxOn(v); if (v) audio.click(); };
  const toggleMusic = () => {
    const v = !musicOn; audio.unlock(); audio.setMusicMuted(!v); setMusicOn(v);
    if (v && !audio.musicPlaying && st.current.screen !== "boot") audio.startMusic();
  };

  // ---------- keyboard ----------
  act.current = { launch: () => launch(false), pressStart, nextStory, skipStory, goTitle, pauseRun, resumeRun };
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const { screen: sc, bootStep: bs } = st.current;
      const code = e.code;
      const isJ = JUMP_KEYS.has(code), isF = FIRE_KEYS.has(code);
      if (isJ || isF || code === "Enter" || code === "Escape" || code === "KeyP") {
        if (sc === "run" || isJ) e.preventDefault();
      }
      if (e.repeat) return;
      if (sc === "boot") { if (bs === 2) act.current.pressStart(); return; }
      if (sc === "story") { if (code === "Enter" || code === "Space") act.current.nextStory(); if (code === "Escape") act.current.skipStory(); return; }
      if (sc === "title") { if (code === "Enter" || code === "Space") act.current.launch(); return; }
      if (sc === "run") {
        if (isJ) { runnerRef.current?.jump(); setPadJump(true); setTimeout(() => setPadJump(false), 110); }
        if (isF) { runnerRef.current?.fire(true); setPadFire(true); }
        if (code === "Escape" || code === "KeyP") act.current.pauseRun();
        return;
      }
      if (sc === "pause") { if (code === "Escape" || code === "KeyP" || code === "Enter") act.current.resumeRun(); return; }
      if (sc === "result") { if (code === "Enter") act.current.launch(); if (code === "Escape") act.current.goTitle(); return; }
      if ((sc === "board" || sc === "ghost") && code === "Escape") setScreen(st.current.back);
    };
    const ku = (e: KeyboardEvent) => { if (FIRE_KEYS.has(e.code)) { runnerRef.current?.fire(false); setPadFire(false); } };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- pads ----------
  const jumpDown = (e: RPointerEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); setPadJump(true); if (st.current.screen === "run") runnerRef.current?.jump(); };
  const jumpUp = () => setPadJump(false);
  const fireDown = (e: RPointerEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); setPadFire(true); if (st.current.screen === "run") runnerRef.current?.fire(true); };
  const fireUp = () => { setPadFire(false); runnerRef.current?.fire(false); };

  const best = session ? loadBest(session.seed) : null;
  const running = screen === "run" || screen === "pause";
  const stageName = (n: number) => ["THE CELL BLOCK", "THE LAB CORRIDOR", "THE CARGO BAY", "THE BREAKOUT"][n];

  return (
    <div className="shell">
      <div className="device">
        {/* ---------- left rail ---------- */}
        <aside className="rail">
          <div className="rgroup">
            <Key label="Sound effects" onClick={toggleSfx} active={sfxOn}>{Icon.speaker(!sfxOn)}</Key>
            <Key label="Music" onClick={toggleMusic} active={musicOn}>{Icon.note(!musicOn)}</Key>
          </div>
          <div
            className={`pad ${padJump ? "down" : ""}`}
            role="button" aria-label="Jump"
            onPointerDown={jumpDown} onPointerUp={jumpUp} onPointerCancel={jumpUp}
          >
            <div className="knob"><span className="ico">{Icon.up()}</span></div>
            <span className="pad-l">JUMP</span>
          </div>
          <div className="rgroup">
            <Key label={screen === "pause" ? "Resume" : "Pause"} disabled={!running} onClick={screen === "pause" ? resumeRun : pauseRun}>
              {screen === "pause" ? Icon.play() : Icon.pause()}
            </Key>
          </div>
        </aside>

        {/* ---------- screen ---------- */}
        <main className="screen">
          {session && <Game key={session.key} seed={session.seed} ghost={session.ghost} tutorial={!tutDone} runnerRef={runnerRef} onDone={onDone} />}

          {/* boot: splash -> loading -> press start */}
          {screen === "boot" && (
            <div className="ov boot" onPointerDown={() => bootStep === 2 && pressStart()}>
              {bootStep === 0 && (
                <div className="splash">
                  <Mark size={92} />
                  <div className="splash-t">YETI PROOF-OF-RUN</div>
                  <div className="splash-s">REPLAY-VERIFIED ON SUI</div>
                </div>
              )}
              {bootStep === 1 && (
                <div className="loadbox">
                  <div className="lb-row"><span>LOADING</span><span>{Math.round(bootPct * 100)}%</span></div>
                  <div className="bar"><i style={{ width: `${bootPct * 100}%` }} /></div>
                  <div className="tip">{TIPS[tip]}</div>
                </div>
              )}
              {bootStep === 2 && (
                <div className="press">
                  <Mark size={72} />
                  <div className="press-t">ESCAPE FROM HALCYON</div>
                  <div className="press-b">PRESS START</div>
                </div>
              )}
            </div>
          )}

          {screen === "story" && (
            <div className="ov dim story" onPointerDown={nextStory}>
              <div className="story-t" key={story}>{STORY[story].split("\n").map((l, i) => <div key={i} style={{ animationDelay: `${i * 0.7}s` }}>{l}</div>)}</div>
              <div className="story-f"><span>{story + 1} / {STORY.length}</span><span className="blink">TAP TO CONTINUE</span></div>
              <button className="skip" onPointerDown={(e) => e.stopPropagation()} onClick={skipStory}>SKIP</button>
            </div>
          )}

          {screen === "title" && (
            <div className="ov dim title">
              <div className="t-left">
                <div className="eyebrow">SUBJECT Y-7</div>
                <h1>ESCAPE FROM<br />HALCYON</h1>
                <p className="logline">Jump the crates, shoot the sentries, duck the drones. Every score is replayed and verified on Sui.</p>
                <div className="chips">
                  {mode === "daily" && now !== null && <span className="chip">DAY <b>{day}</b></span>}
                  {mode === "daily" && now !== null && <span className="chip">RESETS IN <b>{fmtCountdown(msUntilNextDay(now))}</b></span>}
                  <span className="chip">BEST <b>{best ? best.score : "-"}</b></span>
                  {session?.ghost && <span className="chip ghost">GHOST READY</span>}
                </div>
                {log[0] && !log[0].ok && (
                  <div className="status bad" style={{ marginTop: 10, wordBreak: "break-word", userSelect: "text" }}>{log[0].msg}</div>
                )}
              </div>
              <nav className="t-menu">
                <button className="mbtn primary" onClick={() => launch(false)}><b>RUN</b><small>Practice. Free, no wallet.</small></button>
                <button className="mbtn warm" disabled={!acct || !configured} onClick={() => launch(true)}>
                  <b>VERIFIED RUN</b><small>{!configured ? "Contract not configured" : acct ? "Mints a receipt, can rank" : "Connect a wallet first"}</small>
                </button>
                <button className="mbtn" onClick={toggleMode}><b>MODE: {mode === "daily" ? "DAILY CHALLENGE" : "FREE RUN"}</b><small>{mode === "daily" ? "Same course for everyone today" : "New random course each run"}</small></button>
                <div className="mrow">
                  <button className="mbtn half" onClick={() => open("board")}><b>LEADERBOARD</b></button>
                  <button className="mbtn half" onClick={() => open("ghost")}><b>GHOST</b></button>
                </div>
                {acct ? (
                  <button className="mbtn slim" onClick={() => { audio.click(); disconnect(); }}><b>{short(acct.address)}</b><small>TAP TO DISCONNECT</small></button>
                ) : (
                  <>
                    <ConnectModal trigger={<button className="mbtn slim" onClick={() => audio.click()}><b>CONNECT WALLET</b><small>For verified runs</small></button>} />
                    {isMobile && <p className="note note-in">On a phone: pick Slush (sign in with Google, Apple or a passkey), or open this page in your wallet app's built-in browser.</p>}
                  </>
                )}
              </nav>
            </div>
          )}

          {screen === "loading" && (
            <div className="ov load">
              <div className="load-in">
                <div className="eyebrow">{session?.label ?? ""}</div>
                <div className="load-h">STAGE 1</div>
                <div className="load-s">{STAGES[0].name}</div>
                <div className="bar big"><i style={{ width: `${loadPct * 100}%` }} /></div>
                <div className="lb-row"><span>{loadMsg}</span><span>{Math.round(loadPct * 100)}%</span></div>
                <div className="tip">{TIPS[tip]}</div>
              </div>
            </div>
          )}

          {screen === "pause" && (
            <div className="ov dim">
              <div className="panel narrow">
                <div className="p-head"><h2>PAUSED</h2><span>{session?.label}</span></div>
                <div className="p-body col">
                  <button className="mbtn primary" onClick={resumeRun}><b>RESUME</b></button>
                  <button className="mbtn" onClick={goTitle}><b>QUIT TO MENU</b></button>
                </div>
              </div>
            </div>
          )}

          {screen === "result" && result && session && (
            <div className="ov dim">
              <div className="panel">
                <div className="p-head">
                  <h2>{result.escaped ? "SUBJECT Y-7 ESCAPED" : `RECAPTURED IN ${stageName(result.stage)}`}</h2>
                  <span>{session.label}</span>
                </div>
                <div className="p-body">
                  <div className="score-col">
                    <div className="score-l">FINAL SCORE</div>
                    <div className="score-n">{String(result.score).padStart(6, "0")}</div>
                    <div className="badges">
                      {result.newBest && <span className="badge gold">NEW BEST</span>}
                      <span className={`badge ${result.localOk ? "ok" : "bad"}`}>{result.localOk ? "REPLAY MATCH" : "REPLAY MISMATCH"}</span>
                      {submitted && <span className="badge ok">VERIFIED ON-CHAIN</span>}
                    </div>
                  </div>
                  <div className="stats">
                    <div><span>TAKEDOWNS</span><b>{result.kills}</b></div>
                    <div><span>HEALTH LEFT</span><b>{result.hp} / 5</b></div>
                    <div><span>STAGE</span><b>{result.stage + 1} / 4</b></div>
                    <div><span>INPUTS</span><b>{result.jumps.length} / {result.shots.length}</b></div>
                  </div>
                </div>
                {log[0] && (
                  <div className={`status ${log[0].ok ? "ok" : "bad"}`}>
                    {log[0].msg} {log[0].digest && <a href={explorer(log[0].digest)} target="_blank" rel="noreferrer">VIEW TX</a>}
                  </div>
                )}
                <div className="p-foot">
                  <button className="mbtn primary" onClick={() => launch(false)}><b>RUN AGAIN</b></button>
                  {session.verified && session.runId && (
                    <button className="mbtn warm" disabled={busy} onClick={() => submit(false)}><b>{busy ? "VERIFYING..." : "SUBMIT ON-CHAIN"}</b></button>
                  )}
                  <button className="mbtn" onClick={copyBest}><b>COPY GHOST</b></button>
                  <button className="mbtn" onClick={() => open("board")}><b>LEADERBOARD</b></button>
                  <button className="mbtn" onClick={goTitle}><b>MENU</b></button>
                </div>
                {session.verified && session.runId && (
                  <button className="forge" disabled={busy} onClick={() => submit(true)}>Security test: submit a forged score (the contract should reject it)</button>
                )}
              </div>
            </div>
          )}

          {screen === "board" && (
            <div className="ov dim">
              <div className="panel">
                <div className="p-head"><h2>LEADERBOARD</h2><span>VERIFIED ON-CHAIN - TOP 10</span></div>
                <div className="tabs">
                  {(["all", "today", "season"] as Tab[]).map((t) => (
                    <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => { audio.click(); setTab(t); }}>
                      {t === "all" ? "ALL-TIME" : t === "today" ? "TODAY" : "SEASON"}
                    </button>
                  ))}
                </div>
                {(() => {
                  const rows = tab === "all" ? board : tab === "today" ? dayRows : seasonRows;
                  const unit = tab === "season" ? "POINTS" : "SCORE";
                  const missing = tab === "all" ? !LEADERBOARD_ID : !REGISTRY_ID;
                  return (
                    <div className="table">
                      <div className="tr th"><span>RANK</span><span>PLAYER</span><span>{unit}</span></div>
                      {rows.length === 0 && <div className="tr empty"><span>{missing ? "Contract not configured yet." : tab === "season" ? "No points yet. Finalize a finished day to award them." : "No verified runs yet. Be the first."}</span></div>}
                      {rows.map((b, i) => (
                        <div key={i} className={`tr ${acct && String(b.player) === acct.address ? "me" : ""}`}>
                          <span>{String(i + 1).padStart(2, "0")}</span><span>{short(String(b.player))}</span><span>{Number(b.score).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {tab === "season" && REGISTRY_ID && acct && (
                  <div className="shop">
                    <p className="note note-in">Your reward points: <b>{myPoints ?? 0}</b>. Earned once per day on a verified daily run (1, +2 if you escape, +5 on every 5-day streak).</p>
                    <div className="mrow">
                      <button className="mbtn half" disabled={busy} onClick={() => redeem(0, "Ice Shard")}><b>ICE SHARD</b><small>Common - 5 pts</small></button>
                      <button className="mbtn half" disabled={busy} onClick={() => redeem(1, "Frozen Helm")}><b>FROZEN HELM</b><small>Rare - 25 pts - 5,000 max</small></button>
                      <button className="mbtn half" disabled={busy} onClick={() => redeem(2, "Glacier Armor")}><b>GLACIER ARMOR</b><small>Epic - 60 pts - 1,000 max</small></button>
                    </div>
                    <p className="note note-in">Eternal Crown (legendary, 100 max) is only granted to season winners and event champions.</p>
                  </div>
                )}
                {tab === "today" && <p className="note note-in">Daily boards keep each player's best verified score. Winners of finished days earn season points (5 / 3 / 1) and a Trophy.</p>}
                <div className="p-foot">
                  <button className="mbtn" onClick={() => { audio.click(); setScreen(back); }}><b>BACK</b></button>
                  {tab !== "all" && REGISTRY_ID && acct && <button className="mbtn warm" disabled={busy} onClick={finalizeYesterday}><b>FINALIZE YESTERDAY</b></button>}
                </div>
              </div>
            </div>
          )}

          {screen === "ghost" && (
            <div className="ov dim">
              <div className="panel">
                <div className="p-head"><h2>GHOST RACING</h2><span>RACE ANY RUN ON ITS OWN SEED</span></div>
                <div className="p-body col">
                  <p className="note">Your best run on a seed replays as a see-through ghost the next time you play that seed. Share a code and a friend races your exact run. The score is re-computed here when a code is imported, so a code cannot lie.</p>
                  <input className="field" placeholder="Paste a ghost code (YG2:...)" value={ghostCode} onChange={(e) => setGhostCode(e.target.value)} spellCheck={false} />
                </div>
                <div className="p-foot">
                  <button className="mbtn primary" disabled={!ghostCode} onClick={importGhost}><b>RACE THIS GHOST</b></button>
                  <button className="mbtn" onClick={copyBest}><b>COPY MY BEST</b></button>
                  <button className="mbtn" onClick={() => { audio.click(); setScreen(back); }}><b>BACK</b></button>
                </div>
              </div>
            </div>
          )}

          {toast && <div className="toast">{toast}</div>}
        </main>

        {/* ---------- right rail ---------- */}
        <aside className="rail">
          <div className="rgroup"><div className="brand"><Mark size={48} /></div></div>
          <div
            className={`pad fire ${padFire ? "down" : ""}`}
            role="button" aria-label="Fire"
            onPointerDown={fireDown} onPointerUp={fireUp} onPointerCancel={fireUp} onPointerLeave={() => padFire && fireUp()}
          >
            <div className="knob"><span className="fl">F</span></div>
            <span className="pad-l">FIRE</span>
          </div>
          <div className="rgroup">
            <Key label="Leaderboard" disabled={running || screen === "boot" || screen === "loading"} onClick={() => open("board")}>{Icon.trophy()}</Key>
          </div>
        </aside>
      </div>

      <div className="rotate"><div><Mark size={56} /><p>ROTATE YOUR DEVICE</p><small>Escape from Halcyon plays in landscape.</small></div></div>
    </div>
  );
}
