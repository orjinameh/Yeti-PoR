// Chain reads for the gRPC-based Sui client (@mysten/sui v2). The old JSON-RPC client is being retired by Sui.
// Move object content is parsed from BCS bytes (stable) using layouts that mirror move/sources/proof_of_run.move.
import { bcs } from "@mysten/sui/bcs";

const TableBcs = bcs.struct("Table", { id: bcs.Address, size: bcs.u64() });
const EntryBcs = bcs.struct("Entry", { player: bcs.Address, score: bcs.u64() });
const LeaderboardBcs = bcs.struct("Leaderboard", { id: bcs.Address, entries: bcs.vector(EntryBcs) });
const RegistryBcs = bcs.struct("Registry", { id: bcs.Address, days: TableBcs, season: TableBcs, profiles: TableBcs, minted: TableBcs });
const DayBoardBcs = bcs.struct("DayBoard", { entries: bcs.vector(EntryBcs), finalized: bcs.bool() });
const ProfileBcs = bcs.struct("Profile", { points: bcs.u64(), last_day: bcs.u64(), streak: bcs.u64() });
const RunBcs = bcs.struct("Run", { id: bcs.Address, seed: bcs.u64(), day: bcs.u64() });

export type Row = { player: string; score: string };

const toBytes = (x: any): Uint8Array => (x instanceof Uint8Array ? x : new Uint8Array(x));
const rows = (entries: { player: string; score: string }[]): Row[] => entries.map((e) => ({ player: String(e.player), score: String(e.score) }));

async function content(client: any, objectId: string): Promise<{ type: string; bytes: Uint8Array; previousTransaction?: string }> {
  const { object } = await client.getObject({ objectId, include: { content: true, previousTransaction: true } });
  if (!object?.content) throw new Error(`Object ${objectId} has no readable content yet`);
  return { type: String(object.type ?? ""), bytes: toBytes(object.content), previousTransaction: object.previousTransaction };
}

export async function waitTx(client: any, digest: string): Promise<{ ok: boolean; error?: string; created: string[] }> {
  const r = await client.waitForTransaction({ digest, timeout: 60000, include: { effects: true } });
  const t = r.Transaction ?? r.FailedTransaction;
  const ok = r.$kind ? r.$kind !== "FailedTransaction" : !!t?.status?.success;
  const error: string | undefined = t?.status?.error?.message ?? (ok ? undefined : "Transaction failed");
  const created = ((t?.effects?.changedObjects ?? []) as any[]).filter((c) => c.idOperation === "Created").map((c) => String(c.objectId));
  return { ok, error, created };
}

/** Finds the Run object that a start_run / start_daily_run transaction just created, and its seed. */
export async function findNewRun(client: any, owner: string, digest: string, created: string[], runType: string): Promise<{ objectId: string; seed: bigint } | null> {
  for (const id of created) {
    try {
      const c = await content(client, id);
      if (c.type.endsWith("::Run")) return { objectId: id, seed: BigInt(RunBcs.parse(c.bytes).seed) };
    } catch { /* try the next one */ }
  }
  // fallback: look through the account's Run objects for the one made by this transaction
  const list = await client.listOwnedObjects({ owner, type: runType });
  for (const o of (list?.objects ?? []) as any[]) {
    try {
      const c = await content(client, String(o.objectId));
      if (c.previousTransaction === digest) return { objectId: String(o.objectId), seed: BigInt(RunBcs.parse(c.bytes).seed) };
    } catch { /* ignore */ }
  }
  return null;
}

export async function readLeaderboard(client: any, id: string): Promise<Row[]> {
  const c = await content(client, id);
  return rows(LeaderboardBcs.parse(c.bytes).entries);
}

export async function readRegistryTables(client: any, id: string): Promise<{ days: string; season: string; profiles: string }> {
  const c = await content(client, id);
  const r = RegistryBcs.parse(c.bytes);
  return { days: r.days.id, season: r.season.id, profiles: r.profiles.id };
}

export async function readProfilePoints(client: any, profilesId: string, address: string): Promise<number> {
  try {
    const { dynamicField } = await client.getDynamicField({ parentId: profilesId, name: { type: "address", bcs: bcs.Address.serialize(address).toBytes() } });
    return Number(ProfileBcs.parse(toBytes(dynamicField.value.bcs)).points);
  } catch { return 0; }
}

export async function readDayBoard(client: any, daysId: string, day: number): Promise<Row[]> {
  try {
    const { dynamicField } = await client.getDynamicField({ parentId: daysId, name: { type: "u64", bcs: bcs.u64().serialize(day).toBytes() } });
    return rows(DayBoardBcs.parse(toBytes(dynamicField.value.bcs)).entries);
  } catch { return []; }
}

export async function readSeason(client: any, seasonId: string): Promise<Row[]> {
  const page = await client.listDynamicFields({ parentId: seasonId, limit: 50 });
  const out = await Promise.all(
    ((page?.dynamicFields ?? []) as any[]).map(async (f) => {
      const { dynamicField } = await client.getDynamicField({ parentId: seasonId, name: f.name });
      return { player: bcs.Address.parse(toBytes(f.name.bcs)), score: bcs.u64().parse(toBytes(dynamicField.value.bcs)) };
    }),
  );
  return out.sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 10).map((e) => ({ player: String(e.player), score: String(e.score) }));
}
