/// Yeti Proof-of-Run: a runner whose score is replay-verified on-chain.
/// The physics below MUST stay identical to lib/engine.ts (integer-only, no signed math).
module proof_of_run::proof_of_run;

use sui::random::{Self, Random};

const TICKS: u64 = 600;
const MAX_ENTRIES: u64 = 10;
const E_BAD_LOG: u64 = 1;
const E_SCORE_MISMATCH: u64 = 2;

const PROFILE: vector<u64> = vector[9, 16, 22, 27, 30, 31, 31, 30, 27, 22, 16, 9];

public struct Run has key { id: UID, seed: u64 }

public struct Receipt has key, store { id: UID, seed: u64, score: u64 }

public struct Entry has copy, drop, store { player: address, score: u64 }

public struct Leaderboard has key { id: UID, entries: vector<Entry> }

fun init(ctx: &mut TxContext) {
    transfer::share_object(Leaderboard { id: object::new(ctx), entries: vector[] });
}

fun next(rng: u64): u64 { (rng * 1103515245 + 12345) % 2147483648 }

fun draw(rng: u64): u64 { (rng / 65536) % 10 }

/// Deterministic replay. Aborts E_BAD_LOG on a malformed input log.
public fun replay(seed: u64, jumps: &vector<u16>): u64 {
    let n = jumps.length();
    assert!(n <= TICKS, E_BAD_LOG);
    let mut i = 0;
    let mut prev = 0u64;
    while (i < n) {
        let j = (jumps[i] as u64);
        assert!(j < TICKS, E_BAD_LOG);
        if (i > 0) assert!(j > prev, E_BAD_LOG);
        prev = j;
        i = i + 1;
    };

    let mut rng = next(seed % 2147483648);
    let mut start = 20 + draw(rng);
    let mut tick = 0u64;
    let mut air = 0u64;
    let mut idx = 0u64;
    let mut passed = 0u64;
    let mut dead = false;

    while (tick < TICKS && !dead) {
        if (idx < n && (jumps[idx] as u64) == tick) {
            idx = idx + 1;
            if (air == 0) air = 1;
        };
        let h = if (air == 0) 0 else *vector::borrow(&PROFILE, air - 1);
        if (tick >= start && tick <= start + 2 && h < 3) {
            dead = true;
        } else {
            if (tick == start + 2) {
                passed = passed + 1;
                rng = next(rng);
                start = start + 16 + draw(rng);
            };
            if (air > 0) {
                air = air + 1;
                if (air > 12) air = 0;
            };
            tick = tick + 1;
        };
    };
    passed * 100 + tick
}

/// Seed comes from sui::random. Must stay a non-public `entry` fun.
entry fun start_run(r: &Random, ctx: &mut TxContext) {
    let mut g = random::new_generator(r, ctx);
    let seed = (random::generate_u32(&mut g) as u64);
    transfer::transfer(Run { id: object::new(ctx), seed }, ctx.sender());
}

/// Replays the log, requires the claimed score to match, records it, mints a receipt.
/// A forged log or score aborts with E_SCORE_MISMATCH and the Run is not consumed.
entry fun submit_run(
    board: &mut Leaderboard,
    run: Run,
    jumps: vector<u16>,
    claimed_score: u64,
    ctx: &mut TxContext,
) {
    let Run { id, seed } = run;
    id.delete();
    let score = replay(seed, &jumps);
    assert!(score == claimed_score, E_SCORE_MISMATCH);

    board.entries.push_back(Entry { player: ctx.sender(), score });
    let mut k = board.entries.length() - 1;
    while (k > 0 && board.entries[k].score > board.entries[k - 1].score) {
        board.entries.swap(k, k - 1);
        k = k - 1;
    };
    if (board.entries.length() > MAX_ENTRIES) { board.entries.pop_back(); };

    transfer::public_transfer(Receipt { id: object::new(ctx), seed, score }, ctx.sender());
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
