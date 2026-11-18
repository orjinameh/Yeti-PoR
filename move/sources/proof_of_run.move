/// Yeti Proof-of-Run v2: Subject Y-7 escapes Halcyon Station; the score is replay-verified on-chain.
/// The physics below MUST stay identical to lib/engine.ts (integer-only, no signed math).
module proof_of_run::proof_of_run;

use sui::clock::Clock;
use sui::random::{Self, Random};
use sui::table::{Self, Table};

const TICKS: u64 = 1800;
const STAGE_TICKS: u64 = 450;
const MAX_ENTRIES: u64 = 10;
const HP_MAX: u64 = 5;
const INV_TICKS: u64 = 6;
const SHOT_CD: u64 = 3;
const RANGE: u64 = 12;
const E_BAD_LOG: u64 = 1;
const E_SCORE_MISMATCH: u64 = 2;
const E_DAY_FINALIZED: u64 = 3;
const E_DAY_OPEN: u64 = 4;
const E_NO_DAY: u64 = 5;
const E_POINTS: u64 = 6;
const E_SOLD_OUT: u64 = 7;
const E_NOT_FOR_SALE: u64 = 8;
const E_BAD_KIND: u64 = 9;
const DAY_MS: u64 = 86400000;

// Cosmetic kinds: 0 Ice Shard (common), 1 Frozen Helm (rare), 2 Glacier Armor (epic), 3 Eternal Crown (legendary).
// Kinds 0-2 can be bought with reward points; kind 3 is only granted (season winners, events, tournaments).
const COST_SHARD: u64 = 5;
const COST_HELM: u64 = 25;
const COST_ARMOR: u64 = 60;
const CAP_HELM: u64 = 5000;
const CAP_ARMOR: u64 = 1000;
const CAP_CROWN: u64 = 100;

const PROFILE: vector<u64> = vector[9, 16, 22, 27, 30, 31, 31, 30, 27, 22, 16, 9];

/// day = 0 for free runs, otherwise the UTC day number of the daily challenge.
public struct Run has key { id: UID, seed: u64, day: u64 }

public struct Receipt has key, store { id: UID, seed: u64, score: u64, day: u64 }

public struct Entry has copy, drop, store { player: address, score: u64 }

public struct Leaderboard has key { id: UID, entries: vector<Entry> }

/// One top-10 per UTC day (best score per player) plus season points per player.
public struct DayBoard has store { entries: vector<Entry>, finalized: bool }

/// Reward points are earned once per UTC day per player (first verified daily run), which stops farming.
public struct Profile has store { points: u64, last_day: u64, streak: u64 }

public struct Registry has key {
    id: UID,
    days: Table<u64, DayBoard>,
    season: Table<address, u64>,
    profiles: Table<address, Profile>,
    minted: Table<u8, u64>,
}

/// Held by the publisher. Needed to grant limited cosmetics (season prizes, events, tournaments).
public struct AdminCap has key, store { id: UID }

public struct Cosmetic has key, store { id: UID, kind: u8, season: u64, serial: u64 }

/// Minted to the verified winner of a finished daily challenge.
public struct Trophy has key, store { id: UID, day: u64, seed: u64, score: u64 }

fun init(ctx: &mut TxContext) {
    transfer::share_object(Leaderboard { id: object::new(ctx), entries: vector[] });
    transfer::share_object(Registry {
        id: object::new(ctx),
        days: table::new(ctx),
        season: table::new(ctx),
        profiles: table::new(ctx),
        minted: table::new(ctx),
    });
    transfer::public_transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

fun sort_desc(v: &mut vector<Entry>) {
    let n = v.length();
    let mut i = 1;
    while (i < n) {
        let mut k = i;
        while (k > 0 && v[k].score > v[k - 1].score) {
            v.swap(k, k - 1);
            k = k - 1;
        };
        i = i + 1;
    };
}

fun record_day(reg: &mut Registry, day: u64, player: address, score: u64) {
    if (!reg.days.contains(day)) {
        reg.days.add(day, DayBoard { entries: vector[], finalized: false });
    };
    let b = reg.days.borrow_mut(day);
    assert!(!b.finalized, E_DAY_FINALIZED);
    let n = b.entries.length();
    let mut i = 0;
    let mut found = false;
    while (i < n) {
        if (b.entries[i].player == player) {
            found = true;
            if (score > b.entries[i].score) {
                let e = &mut b.entries[i];
                e.score = score;
            };
            break
        };
        i = i + 1;
    };
    if (!found) b.entries.push_back(Entry { player, score });
    sort_desc(&mut b.entries);
    while (b.entries.length() > MAX_ENTRIES) { b.entries.pop_back(); };
}

fun add_points(reg: &mut Registry, player: address, pts: u64) {
    if (reg.season.contains(player)) {
        let v = reg.season.borrow_mut(player);
        *v = *v + pts;
    } else {
        reg.season.add(player, pts);
    };
}

fun award_daily(reg: &mut Registry, player: address, day: u64, alive: bool) {
    if (!reg.profiles.contains(player)) {
        reg.profiles.add(player, Profile { points: 0, last_day: 0, streak: 0 });
    };
    let p = reg.profiles.borrow_mut(player);
    if (p.last_day == day) return; // already rewarded today
    p.streak = if (p.last_day + 1 == day) p.streak + 1 else 1;
    p.last_day = day;
    let mut pts = 1u64;
    if (alive) pts = pts + 2;
    if (p.streak % 5 == 0) pts = pts + 5;
    p.points = p.points + pts;
}

fun mint_cosmetic(reg: &mut Registry, kind: u8, season: u64, to: address, ctx: &mut TxContext) {
    assert!(kind <= 3, E_BAD_KIND);
    let cap = if (kind == 1) CAP_HELM else if (kind == 2) CAP_ARMOR else if (kind == 3) CAP_CROWN else 0;
    if (!reg.minted.contains(kind)) reg.minted.add(kind, 0);
    let m = reg.minted.borrow_mut(kind);
    assert!(cap == 0 || *m < cap, E_SOLD_OUT);
    *m = *m + 1;
    let serial = *m;
    transfer::public_transfer(Cosmetic { id: object::new(ctx), kind, season, serial }, to);
}

/// Spend reward points on a cosmetic (kinds 0-2). Limited kinds have a hard supply cap.
entry fun redeem(reg: &mut Registry, kind: u8, ctx: &mut TxContext) {
    assert!(kind <= 2, E_NOT_FOR_SALE);
    let cost = if (kind == 0) COST_SHARD else if (kind == 1) COST_HELM else COST_ARMOR;
    let who = ctx.sender();
    assert!(reg.profiles.contains(who), E_POINTS);
    let p = reg.profiles.borrow_mut(who);
    assert!(p.points >= cost, E_POINTS);
    p.points = p.points - cost;
    mint_cosmetic(reg, kind, 0, who, ctx);
}

/// Admin-only: issue a cosmetic as a season, event or tournament prize (any kind, supply-capped).
entry fun grant(_: &AdminCap, reg: &mut Registry, kind: u8, season: u64, to: address, ctx: &mut TxContext) {
    mint_cosmetic(reg, kind, season, to, ctx);
}

/// Anyone can finalize a day once it has ended: top 3 get season points (5/3/1), the winner gets a Trophy.
entry fun finalize_day(reg: &mut Registry, clock: &Clock, day: u64, ctx: &mut TxContext) {
    assert!(day < clock.timestamp_ms() / DAY_MS, E_DAY_OPEN);
    assert!(reg.days.contains(day), E_NO_DAY);
    let mut winners = vector<address>[];
    let mut top_score = 0u64;
    {
        let b = reg.days.borrow_mut(day);
        assert!(!b.finalized, E_DAY_FINALIZED);
        b.finalized = true;
        let n = b.entries.length();
        assert!(n > 0, E_NO_DAY);
        top_score = b.entries[0].score;
        let mut i = 0;
        while (i < n && i < 3) {
            winners.push_back(b.entries[i].player);
            i = i + 1;
        };
    };
    let pts = vector[5u64, 3, 1];
    let mut j = 0;
    while (j < winners.length()) {
        add_points(reg, winners[j], pts[j]);
        j = j + 1;
    };
    transfer::public_transfer(
        Trophy { id: object::new(ctx), day, seed: daily_seed(day), score: top_score },
        winners[0],
    );
}

/// Daily challenge seed. MUST match dailySeed() in lib/daily.ts.
public fun daily_seed(day: u64): u64 { (day * 2654435761 + 40503) % 2147483648 }

fun next(rng: u64): u64 { (rng * 1103515245 + 12345) % 2147483648 }

fun draw(rng: u64): u64 { (rng / 65536) % 10 }

fun roll(rng: u64): u64 { (rng / 256) % 100 }

/// 0 crate, 1 sentry, 2 drone. Mix depends on the stage the obstacle starts in.
fun kind_for(r: u64, start: u64): u64 {
    let s = start / STAGE_TICKS;
    let stage = if (s > 3) 3 else s;
    if (stage == 0) {
        if (r < 70) 0 else 1
    } else if (stage == 1) {
        if (r < 35) 0 else if (r < 80) 1 else 2
    } else if (stage == 2) {
        if (r < 25) 0 else if (r < 55) 1 else 2
    } else {
        if (r < 20) 0 else if (r < 50) 1 else 2
    }
}

fun hp_for(kind: u64): u64 {
    if (kind == 1) 2 else if (kind == 2) 1 else 0
}

fun check_log(log: &vector<u16>) {
    let n = log.length();
    assert!(n <= TICKS, E_BAD_LOG);
    let mut i = 0;
    let mut prev = 0u64;
    while (i < n) {
        let j = (log[i] as u64);
        assert!(j < TICKS, E_BAD_LOG);
        if (i > 0) assert!(j > prev, E_BAD_LOG);
        prev = j;
        i = i + 1;
    };
}

/// Deterministic replay of a jump log + shot log. Aborts E_BAD_LOG on a malformed log.
public fun replay(seed: u64, jumps: &vector<u16>, shots: &vector<u16>): u64 {
    let (score, _) = simulate(seed, jumps, shots);
    score
}

/// Returns (score, survived).
fun simulate(seed: u64, jumps: &vector<u16>, shots: &vector<u16>): (u64, bool) {
    check_log(jumps);
    check_log(shots);
    let nj = jumps.length();
    let ns = shots.length();

    let mut rng = next(seed % 2147483648);
    let mut start = 20 + draw(rng);
    let mut kind = kind_for(roll(rng), start);
    let mut ehp = hp_for(kind);
    let mut tick = 0u64;
    let mut air = 0u64;
    let mut ji = 0u64;
    let mut si = 0u64;
    let mut passed = 0u64;
    let mut kills = 0u64;
    let mut hp = HP_MAX;
    let mut inv = 0u64;
    let mut cd = 0u64;
    let mut dead = false;

    while (tick < TICKS && !dead) {
        if (ji < nj && (jumps[ji] as u64) == tick) {
            ji = ji + 1;
            if (air == 0) air = 1;
        };
        let want_shot = if (si < ns && (shots[si] as u64) == tick) {
            si = si + 1;
            true
        } else {
            false
        };
        if (cd > 0) cd = cd - 1;
        if (want_shot && cd == 0) {
            cd = SHOT_CD;
            if (kind > 0 && ehp > 0 && tick <= start + 2 && start <= tick + RANGE) {
                ehp = ehp - 1;
                if (ehp == 0) kills = kills + 1;
            };
        };
        let h = if (air == 0) 0 else *vector::borrow(&PROFILE, air - 1);
        if (inv > 0) inv = inv - 1;
        if (tick >= start && tick <= start + 2 && inv == 0) {
            let danger = if (kind == 0) {
                h < 3
            } else if (ehp == 0) {
                false
            } else if (kind == 1) {
                h < 3
            } else {
                h >= 3
            };
            if (danger) {
                hp = hp - 1;
                inv = INV_TICKS;
                if (hp == 0) dead = true;
            };
        };
        if (!dead) {
            if (tick == start + 2) {
                passed = passed + 1;
                rng = next(rng);
                start = start + 16 + draw(rng);
                kind = kind_for(roll(rng), start);
                ehp = hp_for(kind);
            };
            if (air > 0) {
                air = air + 1;
                if (air > 12) air = 0;
            };
            tick = tick + 1;
        };
    };
    let mut score = passed * 100 + tick + kills * 50;
    if (!dead) score = score + hp * 50;
    (score, !dead)
}

/// Free run: seed comes from sui::random. Must stay a non-public `entry` fun.
entry fun start_run(r: &Random, ctx: &mut TxContext) {
    let mut g = random::new_generator(r, ctx);
    let seed = (random::generate_u32(&mut g) as u64);
    transfer::transfer(Run { id: object::new(ctx), seed, day: 0 }, ctx.sender());
}

/// Daily challenge: everyone who calls this on the same UTC day gets the same seed.
entry fun start_daily_run(clock: &Clock, ctx: &mut TxContext) {
    let day = clock.timestamp_ms() / 86400000;
    transfer::transfer(Run { id: object::new(ctx), seed: daily_seed(day), day }, ctx.sender());
}

/// Replays both logs, requires the claimed score to match, records it, mints a receipt.
/// A forged log or score aborts with E_SCORE_MISMATCH and the Run is not consumed.
entry fun submit_run(
    board: &mut Leaderboard,
    reg: &mut Registry,
    run: Run,
    jumps: vector<u16>,
    shots: vector<u16>,
    claimed_score: u64,
    ctx: &mut TxContext,
) {
    let Run { id, seed, day } = run;
    id.delete();
    let (score, alive) = simulate(seed, &jumps, &shots);
    assert!(score == claimed_score, E_SCORE_MISMATCH);

    board.entries.push_back(Entry { player: ctx.sender(), score });
    let mut k = board.entries.length() - 1;
    while (k > 0 && board.entries[k].score > board.entries[k - 1].score) {
        board.entries.swap(k, k - 1);
        k = k - 1;
    };
    if (board.entries.length() > MAX_ENTRIES) { board.entries.pop_back(); };

    if (day > 0) {
        record_day(reg, day, ctx.sender(), score);
        award_daily(reg, ctx.sender(), day, alive);
    };

    transfer::public_transfer(Receipt { id: object::new(ctx), seed, score, day }, ctx.sender());
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }

#[test_only]
public fun daily_run_for_testing(day: u64, ctx: &mut TxContext) {
    transfer::transfer(Run { id: object::new(ctx), seed: daily_seed(day), day }, ctx.sender());
}

#[test_only]
public fun submit_for_testing(
    board: &mut Leaderboard,
    reg: &mut Registry,
    run: Run,
    jumps: vector<u16>,
    shots: vector<u16>,
    claimed_score: u64,
    ctx: &mut TxContext,
) { submit_run(board, reg, run, jumps, shots, claimed_score, ctx) }

#[test_only]
public fun finalize_for_testing(reg: &mut Registry, clock: &Clock, day: u64, ctx: &mut TxContext) {
    finalize_day(reg, clock, day, ctx)
}

#[test_only]
public fun reward_points(reg: &Registry, player: address): u64 {
    if (reg.profiles.contains(player)) reg.profiles.borrow(player).points else 0
}

#[test_only]
public fun redeem_for_testing(reg: &mut Registry, kind: u8, ctx: &mut TxContext) { redeem(reg, kind, ctx) }

#[test_only]
public fun grant_for_testing(cap: &AdminCap, reg: &mut Registry, kind: u8, to: address, ctx: &mut TxContext) {
    grant(cap, reg, kind, 1, to, ctx)
}

#[test_only]
public fun season_points(reg: &Registry, player: address): u64 {
    if (reg.season.contains(player)) *reg.season.borrow(player) else 0
}
