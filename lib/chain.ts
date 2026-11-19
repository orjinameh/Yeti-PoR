// Chain reads for the gRPC-based Sui client (@mysten/sui v2). The old JSON-RPC client is being retired by Sui.
// Move object content is parsed from BCS bytes (stable) using layouts that mirror move/sources/proof_of_run.move.
import { bcs } from "@mysten/sui/bcs";

const TableBcs = bcs.struct("Table", { id: bcs.Address, size: bcs.u64() });
const EntryBcs = bcs.struct("Entry", { player: bcs.Address, score: bcs.u64() });
const LeaderboardBcs = bcs.struct("Leaderboard", { id: bcs.Address, entries: bcs.vector(EntryBcs) });
const RegistryBcs = bcs.struct("Registry", { id: bcs.Address, days: TableBcs, season: TableBcs, profiles: TableBcs, minted: TableBcs });
const DayBoardBcs = bcs.struct("DayBoard", { entries: bcs.vector(EntryBcs), finalized: bcs.bool() });
const ProfileBcs = bcs.struct("Profile", { points: bcs.u64(), last_day: bcs.u64(), streak: bcs.u64(), welcomed: bcs.bool(), ach: bcs.u64() });
const SimStateBcs = bcs.struct("SimState", {
  rng: bcs.u64(), start: bcs.u64(), kind: bcs.u64(), ehp: bcs.u64(), tick: bcs.u64(), air: bcs.u64(),
  passed: bcs.u64(), kills: bcs.u64(), hp: bcs.u64(), inv: bcs.u64(), cd: bcs.u64(), dead: bcs.bool(),
});
const RunHeadBcs = bcs.struct("RunHead", { id: bcs.Address, seed: bcs.u64(), day: bcs.u64() });
const RunBcs = bcs.struct("Run", { id: bcs.Address, seed: bcs.u64(), day: bcs.u64(), st: SimStateBcs });
const CosmeticBcs = bcs.struct("Cosmetic", { id: bcs.Address, kind: bcs.u8(), name: bcs.string(), rarity: bcs.string(), season: bcs.u64(), serial: bcs.u64() });
const ReceiptBcs = bcs.struct("Receipt", { id: bcs.Address, seed: bcs.u64(), score: bcs.u64(), day: bcs.u64() });

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
      if (c.type.endsWith("::Run")) return { objectId: id, seed: BigInt(RunHeadBcs.parse(c.bytes.slice(0, 48)).seed) };
    } catch { /* try the next one */ }
  }
  // fallback: look through the account's Run objects for the one made by this transaction
  const list = await client.listOwnedObjects({ owner, type: runType });
  for (const o of (list?.objects ?? []) as any[]) {
    try {
      const c = await content(client, String(o.objectId));
      if (c.previousTransaction === digest) return { objectId: String(o.objectId), seed: BigInt(RunHeadBcs.parse(c.bytes.slice(0, 48)).seed) };
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

/** Human-readable list of the objects a transaction minted (receipt, cosmetics, trophy), so the UI can say what the player earned. */
export async function describeCreated(client: any, created: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of created) {
    try {
      const c = await content(client, id);
      if (c.type.endsWith("::Cosmetic")) {
        const x = CosmeticBcs.parse(c.bytes);
        out.push(`${x.name} (${x.rarity}) edition #${x.serial}`);
      } else if (c.type.endsWith("::Receipt")) {
        const x = ReceiptBcs.parse(c.bytes);
        out.push(`Run receipt, score ${x.score}`);
      } else if (c.type.endsWith("::Trophy")) out.push("Daily champion trophy (soulbound)");
      else if (c.type.endsWith("::Achievement")) {
        const x = AchievementBcs.parse(c.bytes);
        out.push(`Achievement unlocked: ${x.name} (soulbound)`);
      }
    } catch { /* not readable, skip */ }
  }
  return out;
}

/** Tick the on-chain Run has been verified up to (0 for a fresh run). Used to resume a half-submitted long run. */
export async function readRunTick(client: any, runId: string): Promise<number> {
  try {
    const c = await content(client, runId);
    // A Run from an older contract has no simulation state (only id, seed, day = 48 bytes). Parsing it with the
    // current layout reads past the end of the buffer ("Out of bounds access" in Safari), so treat it as a fresh run.
    if (c.bytes.length < 48 + 89) return 0;
    return Number(RunBcs.parse(c.bytes).st.tick);
  } catch {
    return 0; // could not read the state: start from the first segment, the contract rejects it clearly if that is wrong
  }
}

const AchievementBcs = bcs.struct("Achievement", { id: bcs.Address, kind: bcs.u8(), name: bcs.string(), score: bcs.u64() });
const TrophyBcs = bcs.struct("Trophy", { id: bcs.Address, day: bcs.u64(), seed: bcs.u64(), score: bcs.u64() });

export type OwnedItem = {
  id: string; kind: "achievement" | "receipt" | "trophy" | "cosmetic"; title: string; detail: string;
  seed?: string; score?: number; digest?: string; ach?: number;
  /** soulbound items prove an achievement and cannot be traded; cosmetics are the tradable tier */
  soulbound: boolean;
};

/** Everything the wallet owns from this package (receipts, trophies, cosmetics), read straight from the chain. */
export async function readMyItems(client: any, owner: string, pkg: string): Promise<OwnedItem[]> {
  const out: OwnedItem[] = [];
  for (const [kind, name] of [["achievement", "Achievement"], ["receipt", "Receipt"], ["trophy", "Trophy"], ["cosmetic", "Cosmetic"]] as const) {
    let list: any;
    try { list = await client.listOwnedObjects({ owner, type: `${pkg}::proof_of_run::${name}` }); } catch { continue; }
    const objs = ((list?.objects ?? []) as any[]).slice(0, 40);
    const rows = await Promise.all(objs.map(async (o): Promise<OwnedItem | null> => {
      try {
        const id = String(o.objectId);
        const c = await content(client, id);
        const digest = c.previousTransaction;
        if (kind === "achievement") {
          const x = AchievementBcs.parse(c.bytes);
          return { id, kind, title: String(x.name), detail: `Soulbound, earned with score ${Number(x.score).toLocaleString()}`, score: Number(x.score), digest, ach: Number(x.kind), soulbound: true };
        }
        if (kind === "receipt") {
          const x = ReceiptBcs.parse(c.bytes);
          return { id, kind, title: `Run receipt - ${Number(x.score).toLocaleString()}`, detail: `Seed ${x.seed}, day ${x.day}`, seed: String(x.seed), score: Number(x.score), digest, soulbound: true };
        }
        if (kind === "trophy") {
          const x = TrophyBcs.parse(c.bytes);
          return { id, kind, title: `Daily champion trophy - day ${x.day}`, detail: `Score ${Number(x.score).toLocaleString()}, seed ${x.seed}`, seed: String(x.seed), score: Number(x.score), digest, soulbound: true };
        }
        const x = CosmeticBcs.parse(c.bytes);
        return { id, kind, title: String(x.name), detail: `${x.rarity}, edition #${x.serial}`, digest, soulbound: false };
      } catch { return null; }
    }));
    out.push(...rows.filter((r): r is OwnedItem => r !== null));
  }
  return out;
}
