"use client";
import { useCallback, useEffect, useState } from "react";
import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import Providers from "./providers";
import Game from "@/components/Game";
import { PACKAGE_ID, LEADERBOARD_ID, RANDOM_ID, MODULE } from "@/lib/config";
import { replay } from "@/lib/engine.ts";

const explorer = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;

function App() {
  const acct = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExec } = useSignAndExecuteTransaction();
  const [runId, setRunId] = useState<string | null>(null);
  const [seed, setSeed] = useState<bigint | null>(null);
  const [result, setResult] = useState<{ jumps: number[]; score: number } | null>(null);
  const [log, setLog] = useState<{ ok: boolean; msg: string; digest?: string }[]>([]);
  const [board, setBoard] = useState<{ player: string; score: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const push = (e: { ok: boolean; msg: string; digest?: string }) => setLog((l) => [e, ...l]);

  const loadBoard = useCallback(async () => {
    if (!LEADERBOARD_ID) return;
    const o = await client.getObject({ id: LEADERBOARD_ID, options: { showContent: true } });
    const f = (o.data?.content as any)?.fields?.entries ?? [];
    setBoard(f.map((e: any) => e.fields ?? e));
  }, [client]);
  useEffect(() => { loadBoard().catch(() => {}); }, [loadBoard]);

  const start = async () => {
    setBusy(true); setResult(null); setSeed(null);
    try {
      const tx = new Transaction();
      tx.moveCall({ target: `${PACKAGE_ID}::${MODULE}::start_run`, arguments: [tx.object(RANDOM_ID)] });
      const { digest } = await signAndExec({ transaction: tx });
      const r = await client.waitForTransaction({ digest, options: { showObjectChanges: true } });
      const created: any = r.objectChanges?.find((c: any) => c.type === "created" && c.objectType.endsWith(`::${MODULE}::Run`));
      const obj = await client.getObject({ id: created.objectId, options: { showContent: true } });
      setRunId(created.objectId);
      setSeed(BigInt((obj.data?.content as any).fields.seed));
      push({ ok: true, msg: "Run started, seed from sui::random", digest });
    } catch (e: any) { push({ ok: false, msg: `start failed: ${e.message}` }); }
    setBusy(false);
  };

  const submit = async (forge: boolean) => {
    if (!result || !runId) return;
    setBusy(true);
    try {
      const claimed = forge ? result.score + 1000 : result.score;
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE}::submit_run`,
        arguments: [tx.object(LEADERBOARD_ID), tx.object(runId), tx.pure.vector("u16", result.jumps), tx.pure.u64(claimed)],
      });
      const { digest } = await signAndExec({ transaction: tx });
      const r = await client.waitForTransaction({ digest, options: { showEffects: true } });
      const ok = r.effects?.status.status === "success";
      push({ ok, msg: ok ? `Verified on-chain: score ${claimed}` : `REJECTED on-chain: ${r.effects?.status.error}`, digest });
      if (ok) { setRunId(null); loadBoard(); }
    } catch (e: any) {
      // Wallets usually dry-run first, so a forged tx is refused with the Move abort before signing.
      push({ ok: false, msg: `REJECTED (${forge ? "forged" : "error"}): ${e.message}` });
    }
    setBusy(false);
  };

  const btn = { padding: "10px 16px", borderRadius: 8, border: 0, background: "#3b82f6", color: "#fff", fontWeight: 600, cursor: "pointer", marginRight: 8 } as const;
  const configured = PACKAGE_ID && LEADERBOARD_ID;

  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 24 }}>🏔️ Yeti Proof-of-Run</h1>
        <ConnectButton />
      </div>
      <p style={{ opacity: 0.8 }}>Score is not trusted from the client. The Move contract replays your input log from an on-chain seed and computes the score itself. Space / tap to jump.</p>
      {!configured && <p style={{ color: "#ffb347" }}>Set NEXT_PUBLIC_PACKAGE_ID and NEXT_PUBLIC_LEADERBOARD_ID (see README).</p>}

      {seed !== null && !result && <Game seed={seed} onDone={(jumps, score) => setResult({ jumps, score })} />}
      {result && (
        <p>Run over. Local score <b>{result.score}</b> · {result.jumps.length} jumps · local replay check: {replay(seed!, result.jumps) === result.score ? "match" : "MISMATCH"}</p>
      )}

      <div style={{ margin: "12px 0" }}>
        <button style={btn} disabled={!acct || !configured || busy || (!!seed && !result)} onClick={start}>Start verified run</button>
        <button style={btn} disabled={!result || !runId || busy} onClick={() => submit(false)}>Submit run</button>
        <button style={{ ...btn, background: "#e11d48" }} disabled={!result || !runId || busy} onClick={() => submit(true)}>Forge it</button>
      </div>

      <h3>Activity</h3>
      {log.map((e, i) => (
        <div key={i} style={{ padding: 8, marginBottom: 6, borderRadius: 8, background: e.ok ? "#12351f" : "#3a1420" }}>
          {e.msg} {e.digest && <a style={{ color: "#7fd4ff" }} href={explorer(e.digest)} target="_blank" rel="noreferrer">explorer</a>}
        </div>
      ))}

      <h3>Leaderboard (replay-verified)</h3>
      <ol>{board.map((b, i) => <li key={i}>{b.score} · {String(b.player).slice(0, 10)}…</li>)}</ol>
    </main>
  );
}

export default function Page() { return <Providers><App /></Providers>; }
