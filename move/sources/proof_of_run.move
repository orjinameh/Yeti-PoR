/// Yeti Proof-of-Run v2: Subject Y-7 escapes Halcyon Station; the score is replay-verified on-chain.
/// The physics below MUST stay identical to lib/engine.ts (integer-only, no signed math).
module proof_of_run::proof_of_run;

use std::string::String;
use sui::clock::Clock;
use sui::display;
use sui::package;
use sui::random::{Self, Random};
use sui::table::{Self, Table};

/// Runs are endless up to MAX_TICKS (3 hours at base speed). One transaction verifies one segment of
/// SEG_TICKS ticks; log ticks are segment-relative. The sim state lives in the Run object between segments.
const MAX_TICKS: u64 = 108000;
const SEG_TICKS: u64 = 1800;
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
public struct Run has key { id: UID, seed: u64, day: u64, st: SimState }

/// Simulation state carried between segments. Mirrors Sim in lib/engine.ts.
public struct SimState has store, copy, drop {
    rng: u64,
    start: u64,
    kind: u64,
    ehp: u64,
    tick: u64,
    air: u64,
    passed: u64,
    kills: u64,
    hp: u64,
    inv: u64,
    cd: u64,
    dead: bool,
}

public struct Receipt has key, store { id: UID, seed: u64, score: u64, day: u64 }

public struct Entry has copy, drop, store { player: address, score: u64 }

public struct Leaderboard has key { id: UID, entries: vector<Entry> }

/// One top-10 per UTC day (best score per player) plus season points per player.
public struct DayBoard has store { entries: vector<Entry>, finalized: bool }

/// Reward points are earned once per UTC day per player (first verified daily run), which stops farming.
public struct Profile has store { points: u64, last_day: u64, streak: u64, welcomed: bool }

public struct Registry has key {
    id: UID,
    days: Table<u64, DayBoard>,
    season: Table<address, u64>,
    profiles: Table<address, Profile>,
    minted: Table<u8, u64>,
}

/// Held by the publisher. Needed to grant limited cosmetics (season prizes, events, tournaments).
public struct AdminCap has key, store { id: UID }

public struct Cosmetic has key, store { id: UID, kind: u8, name: String, rarity: String, season: u64, serial: u64 }

/// One-time witness (module name in capitals) used to claim the Publisher for Display.
public struct PROOF_OF_RUN has drop {}

/// Image host for wallet display. SVGs live in public/nft of the repo; change it later with display::update_version
/// on the Display objects held by the publisher if you host them elsewhere.
const IMAGE_BASE: vector<u8> = b"https://cdn.jsdelivr.net/gh/orjinameh/Yeti-PoR@main/public/nft/";


/// Minted to the verified winner of a finished daily challenge.
public struct Trophy has key, store { id: UID, day: u64, seed: u64, score: u64 }

fun init(otw: PROOF_OF_RUN, ctx: &mut TxContext) {
    let publisher = package::claim(otw, ctx);
    let base: String = IMAGE_BASE.to_string();

    let mut d = display::new_with_fields<Cosmetic>(
        &publisher,
        vector[b"name".to_string(), b"description".to_string(), b"image_url".to_string(), b"project_url".to_string()],
        vector[
            b"{name}".to_string(),
            b"Yeti Proof-of-Run {rarity} cosmetic, edition #{serial}. Earned by playing verified runs.".to_string(),
            { let mut u = copy base; u.append(b"cosmetic-{kind}.svg".to_string()); u },
            b"https://github.com/orjinameh/Yeti-PoR".to_string(),
        ],
        ctx,
    );
    d.update_version();
    transfer::public_transfer(d, ctx.sender());

    let mut t = display::new_with_fields<Trophy>(
        &publisher,
        vector[b"name".to_string(), b"description".to_string(), b"image_url".to_string()],
        vector[
            b"Daily Champion Trophy - day {day}".to_string(),
            b"Won the verified Yeti daily challenge for day {day} with a score of {score}.".to_string(),
            { let mut u = copy base; u.append(b"trophy.svg".to_string()); u },
        ],
        ctx,
    );
    t.update_version();
    transfer::public_transfer(t, ctx.sender());

    let mut r = display::new_with_fields<Receipt>(
        &publisher,
        vector[b"name".to_string(), b"description".to_string(), b"image_url".to_string()],
        vector[
            b"Yeti Run Receipt".to_string(),
            b"Proof that this run was replayed and verified on-chain. Score {score}.".to_string(),
            { let mut u = copy base; u.append(b"receipt.svg".to_string()); u },
        ],
        ctx,
    );
    r.update_version();
    transfer::public_transfer(r, ctx.sender());
    transfer::public_transfer(publisher, ctx.sender());

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

fun ensure_profile(reg: &mut Registry, player: address) {
    if (!reg.profiles.contains(player)) {
        reg.profiles.add(player, Profile { points: 0, last_day: 0, streak: 0, welcomed: false });
    };
}

/// `long` = the run survived at least one full segment (SEG_TICKS ticks).
fun award_daily(reg: &mut Registry, player: address, day: u64, long: bool) {
    ensure_profile(reg, player);
    let p = reg.profiles.borrow_mut(player);
    if (p.last_day == day) return; // already rewarded today
    p.streak = if (p.last_day + 1 == day) p.streak + 1 else 1;
    p.last_day = day;
    let mut pts = 1u64;
    if (long) pts = pts + 2;
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
    let (name, rarity) = if (kind == 0) (b"Ice Shard".to_string(), b"Common".to_string())
        else if (kind == 1) (b"Frozen Helm".to_string(), b"Rare".to_string())
        else if (kind == 2) (b"Glacier Armor".to_string(), b"Epic".to_string())
        else (b"Eternal Crown".to_string(), b"Legendary".to_string());
    transfer::public_transfer(Cosmetic { id: object::new(ctx), kind, name, rarity, season, serial }, to);
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

fun hp_for(kind: u64, start: u64): u64 {
    if (kind == 1) { if (start >= STAGE_TICKS * 6) 3 else 2 } else if (kind == 2) 1 else 0
}

fun new_state(seed: u64): SimState {
    let rng = next(seed % 2147483648);
    let start = 20 + draw(rng);
    let kind = kind_for(roll(rng), start);
    SimState {
        rng, start, kind, ehp: hp_for(kind, start),
        tick: 0, air: 0, passed: 0, kills: 0, hp: HP_MAX, inv: 0, cd: 0, dead: false,
    }
}
}

fun check_log(log: &vector<u16>) {
    let n = log.length();
    assert!(n <= SEG_TICKS, E_BAD_LOG);
    let mut i = 0;
    let mut prev = 0u64;
    while (i < n) {
        let j = (log[i] as u64);
        assert!(j < SEG_TICKS, E_BAD_LOG);
        if (i > 0) assert!(j > prev, E_BAD_LOG);
        prev = j;
        i = i + 1;
    };
}

public fun state_over(st: &SimState): bool { st.dead || st.tick >= MAX_TICKS }

/// Final score of a finished run. The health bonus only applies if the yeti survived the whole 3 hours.
public fun state_score(run: &SimState): u64 {
    let mut score = run.passed * 100 + run.tick + run.kills * 50;
    if (!run.dead && run.tick >= MAX_TICKS) score = score + run.hp * 50;
    score
}

/// Advances the run by one segment (up to SEG_TICKS ticks), consuming the segment-relative logs.
/// Aborts E_BAD_LOG on a malformed log. Must match Sim in lib/engine.ts.
fun advance(run: &mut SimState, jumps: &vector<u16>, shots: &vector<u16>) {
    check_log(jumps);
    check_log(shots);
    let nj = jumps.length();
    let ns = shots.length();

    let base = run.tick;
    let end = if (base + SEG_TICKS > MAX_TICKS) MAX_TICKS else base + SEG_TICKS;
    let mut rng = run.rng;
    let mut start = run.start;
    let mut kind = run.kind;
    let mut ehp = run.ehp;
    let mut tick = run.tick;
    let mut air = run.air;
    let mut ji = 0u64;
    let mut si = 0u64;
    let mut passed = run.passed;
    let mut kills = run.kills;
    let mut hp = run.hp;
    let mut inv = run.inv;
    let mut cd = run.cd;
    let mut dead = run.dead;

    while (tick < end && !dead) {
        let rel = tick - base;
        if (ji < nj && (jumps[ji] as u64) == rel) {
            ji = ji + 1;
            if (air == 0) air = 1;
        };
        let want_shot = if (si < ns && (shots[si] as u64) == rel) {
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
                true // sentries are too big to jump: only shooting them dead avoids the hit
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
                ehp = hp_for(kind, start);
            };
            if (air > 0) {
                air = air + 1;
                if (air > 12) air = 0;
            };
            tick = tick + 1;
        };
    };
    run.rng = rng;
    run.start = start;
    run.kind = kind;
    run.ehp = ehp;
    run.tick = tick;
    run.air = air;
    run.passed = passed;
    run.kills = kills;
    run.hp = hp;
    run.inv = inv;
    run.cd = cd;
    run.dead = dead;
}

/// Single-segment replay (score of the state after the first segment). Used by tests.
public fun replay(seed: u64, jumps: &vector<u16>, shots: &vector<u16>): u64 {
    let mut st = new_state(seed);
    advance(&mut st, jumps, shots);
    state_score(&st)
}

/// Free run: seed comes from sui::random. Must stay a non-public `entry` fun.
entry fun start_run(r: &Random, ctx: &mut TxContext) {
    let mut g = random::new_generator(r, ctx);
    let seed = (random::generate_u32(&mut g) as u64);
    transfer::transfer(Run { id: object::new(ctx), seed, day: 0, st: new_state(seed) }, ctx.sender());
}

/// Daily challenge: everyone who calls this on the same UTC day gets the same seed.
entry fun start_daily_run(clock: &Clock, ctx: &mut TxContext) {
    let day = clock.timestamp_ms() / 86400000;
    transfer::transfer(Run { id: object::new(ctx), seed: daily_seed(day), day, st: new_state(daily_seed(day)) }, ctx.sender());
}

/// Verifies one segment of the run. If the run is not over yet the Run is returned to the player for the
/// next segment. When the run ends (death or 3-hour cap) the claimed score must match, it is recorded and a
/// receipt is minted. A forged log or score aborts with E_SCORE_MISMATCH and the Run is not consumed.
entry fun submit_run(
    board: &mut Leaderboard,
    reg: &mut Registry,
    run: Run,
    jumps: vector<u16>,
    shots: vector<u16>,
    claimed_score: u64,
    ctx: &mut TxContext,
) {
    let Run { id, seed, day, mut st } = run;
    advance(&mut st, &jumps, &shots);
    if (!state_over(&st)) {
        // Run continues: keep it (same object id) so the next segment can be submitted. claimed_score is ignored.
        transfer::transfer(Run { id, seed, day, st }, ctx.sender());
        return
    };
    id.delete();
    let score = state_score(&st);
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
        award_daily(reg, ctx.sender(), day, st.tick >= SEG_TICKS);
    };

    // First verified run ever: a free common Ice Shard so every new player sees something in their wallet.
    ensure_profile(reg, ctx.sender());
    if (!reg.profiles.borrow(ctx.sender()).welcomed) {
        reg.profiles.borrow_mut(ctx.sender()).welcomed = true;
        mint_cosmetic(reg, 0, 0, ctx.sender(), ctx);
    };

    transfer::public_transfer(Receipt { id: object::new(ctx), seed, score, day }, ctx.sender());
}

/// Runs every segment in order and returns the final score (aborts if the run is not over at the end).
#[test_only]
public fun run_segments(seed: u64, js: &vector<vector<u16>>, ss: &vector<vector<u16>>): u64 {
    let mut st = new_state(seed);
    let mut i = 0;
    while (i < js.length()) {
        assert!(!state_over(&st), E_BAD_LOG);
        advance(&mut st, &js[i], &ss[i]);
        i = i + 1;
    };
    assert!(state_over(&st), E_BAD_LOG);
    state_score(&st)
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(PROOF_OF_RUN {}, ctx) }

#[test_only]
public fun daily_run_for_testing(day: u64, ctx: &mut TxContext) {
    transfer::transfer(Run { id: object::new(ctx), seed: daily_seed(day), day, st: new_state(daily_seed(day)) }, ctx.sender());
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
