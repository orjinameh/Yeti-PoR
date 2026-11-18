/// Yeti Proof-of-Run v2: Subject Y-7 escapes Halcyon Station; the score is replay-verified on-chain.
/// The physics below MUST stay identical to lib/engine.ts (integer-only, no signed math).
module proof_of_run::proof_of_run;

use sui::clock::Clock;
use sui::random::{Self, Random};

const TICKS: u64 = 600;
const STAGE_TICKS: u64 = 150;
const MAX_ENTRIES: u64 = 10;
const HP_MAX: u64 = 5;
const INV_TICKS: u64 = 6;
const SHOT_CD: u64 = 3;
const RANGE: u64 = 12;
const E_BAD_LOG: u64 = 1;
const E_SCORE_MISMATCH: u64 = 2;

const PROFILE: vector<u64> = vector[9, 16, 22, 27, 30, 31, 31, 30, 27, 22, 16, 9];

/// day = 0 for free runs, otherwise the UTC day number of the daily challenge.
public struct Run has key { id: UID, seed: u64, day: u64 }

public struct Receipt has key, store { id: UID, seed: u64, score: u64, day: u64 }

public struct Entry has copy, drop, store { player: address, score: u64 }

public struct Leaderboard has key { id: UID, entries: vector<Entry> }

fun init(ctx: &mut TxContext) {
    transfer::share_object(Leaderboard { id: object::new(ctx), entries: vector[] });
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
    score
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
    run: Run,
    jumps: vector<u16>,
    shots: vector<u16>,
    claimed_score: u64,
    ctx: &mut TxContext,
) {
    let Run { id, seed, day } = run;
    id.delete();
    let score = replay(seed, &jumps, &shots);
    assert!(score == claimed_score, E_SCORE_MISMATCH);

    board.entries.push_back(Entry { player: ctx.sender(), score });
    let mut k = board.entries.length() - 1;
    while (k > 0 && board.entries[k].score > board.entries[k - 1].score) {
        board.entries.swap(k, k - 1);
        k = k - 1;
    };
    if (board.entries.length() > MAX_ENTRIES) { board.entries.pop_back(); };

    transfer::public_transfer(Receipt { id: object::new(ctx), seed, score, day }, ctx.sender());
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
