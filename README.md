# Yeti Proof-of-Run (CLAY Hackathon)

A Lofi-the-Yeti runner whose score is **replay-verified in Move on Sui**. The client only logs jump ticks; `submit_run` replays the deterministic sim from an on-chain seed (`sui::random`), computes the score itself, and rejects any mismatch with `E_SCORE_MISMATCH`. Verified runs go to a shared top-10 Leaderboard and mint a Receipt.

Honest limit: this proves a score is consistent with a legal input log, not that a human played it. A perfect bot is still possible.

## Layout
- `lib/engine.ts` – fixed-point TS engine (client). `move/sources/proof_of_run.move` – identical Move engine + entries.
- `move/tests` – shared test vectors from `npm run vectors`. Re-generate and paste if you change the physics.
- `app/`, `components/` – Next.js + dapp-kit UI.

## Run it
1. `cd move && sui move test` (not run in the build environment; fix any compiler nits first).
2. `sui client switch --env testnet`, get faucet SUI, then `sui client publish --gas-budget 200000000`.
3. From the output copy the package id and the shared `Leaderboard` object id into `.env.local` (see `.env.example`).
4. `npm install && npm run dev`, connect a testnet wallet, Start verified run, play, Submit, then Forge it.

## Day-1 risks to check (from the brief)
- Replay gas for 1800 ticks (3 min runs): if too high, lower TICKS or chunk verification across transactions.
- `sui::random` rules: `start_run` is a non-public `entry` taking `&Random` (0x8); keep it that way.
- Forge it: wallets dry-run first, so the abort may show before signing. For the on-chain explorer proof, set a manual gas budget or execute via CLI: `sui client call --package <PKG> --module proof_of_run --function submit_run --args <BOARD> <RUN> "[1,2]" 9999 --gas-budget 50000000`.

## v3: Escape from Halcyon (handheld edition)
The game is presented as a handheld console: a left rail (sound and music keys, jump pad, pause), the screen, and a right rail (fire pad, leaderboard). Boot splash, loading bar, press start, story intro, title menu, a loading screen before every run, a 3-2-1 countdown, pause, result, leaderboard and ghost screens. No emojis anywhere.

Story: Subject Y-7, a yeti held at Halcyon Station, escapes when the cell lock fails. 4 stages of 150 ticks: Cell Block, Lab Corridor, Cargo Bay, The Breakout.

Gameplay (same rules in `lib/engine.ts` and `move/sources/proof_of_run.move`):
- Crates: jump them. Sentries (2 hp, ground): jump or shoot. Drones (1 hp, air): stay low or shoot.
- 5 health, short invulnerability after a hit. Score = gates passed x 100 + ticks survived + takedowns x 50 + health left x 50 if you escape.
- Inputs logged: jump ticks and shot ticks. Hold-to-fire auto-aims the nearest enemy in range.

Controls: Jump = Space / Up / W or the left pad. Fire = hold F / J / K / Right or the right pad. Pause = Esc / P.

Code map: `lib/runner.ts` (sim loop, rendering, input API), `lib/art.ts` (all art), `lib/sprites.ts` (drop-in sprite sheet, see `public/sprites/README.md`), `lib/audio.ts` (procedural music and sfx), `components/Console.tsx` (shell and screens), `components/Game.tsx` (thin canvas wrapper).

Daily challenge: `start_daily_run(clock)` derives the seed from the UTC day. Ghost racing: your best run per seed replays as a ghost; share a `YG2:<seed>:<jumps>:<shots>` code, the score is recomputed on import.

The `Run`, `Receipt`, `submit_run` and replay signatures changed, so publish a fresh package and update `.env.local`.

## v3.1: daily boards, season points, trophies
- `Registry` (shared, created in `init`) keeps a top-10 per UTC day (best verified score per player) and season points per address. Only verified daily runs (day > 0) enter a day board.
- `finalize_day(registry, clock, day)`: callable by anyone once the day has ended. Top 3 get 5/3/1 season points and the winner is minted a `Trophy { day, seed, score }`.
- `submit_run` now takes the Registry: `submit_run(board, registry, run, jumps, shots, claimed)`.
- After publishing, copy the new shared `Registry` object id into `NEXT_PUBLIC_REGISTRY_ID` (see `.env.example`). The leaderboard screen has All-time, Today and Season tabs, plus a Finalize Yesterday action.
- Not compiled in the build environment. Run `sui move test` and fix any compiler nits first. Two scenario tests cover finalize, season points, trophy and the open-day guard (they use test-only wrappers in the module).

## Not built yet
Ghosts from other players (needs winning input logs stored on-chain or in an indexer), a seasons rollover (season is currently one running total), trophy artwork/display.
