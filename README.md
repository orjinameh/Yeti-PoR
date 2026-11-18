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
- Replay gas for 600 ticks: if too high, lower TICKS or chunk verification across transactions.
- `sui::random` rules: `start_run` is a non-public `entry` taking `&Random` (0x8); keep it that way.
- Forge it: wallets dry-run first, so the abort may show before signing. For the on-chain explorer proof, set a manual gas budget or execute via CLI: `sui client call --package <PKG> --module proof_of_run --function submit_run --args <BOARD> <RUN> "[1,2]" 9999 --gas-budget 50000000`.

## v2: polish + competitive edition
- `lib/art.ts` original vector yeti, parallax mountains, snow, ice crystals (no asset files). `lib/audio.ts` procedural lo-fi music + sfx (WebAudio, mute toggle). Replace either with real art/audio any time; the engine is untouched.
- **Daily Yeti Challenge**: `start_daily_run(clock)` derives the seed from the UTC day (`daily_seed` in Move == `dailySeed` in `lib/daily.ts`). Everyone plays the same course.
- **Ghost racing**: best run per seed is stored locally and replays as a ghost. Share with a `YG1:<seed>:<jumps>` code; the score is recomputed on import.
- Run and `Receipt` now carry `day` (0 = free run). This changes struct layout, so **publish a fresh package** and update `.env.local`.
- Visual hitboxes match the engine (airborne min height 38px > crystal 36px; overlap window = 3 ticks).

## Next (not built yet)
Per-day on-chain leaderboard, season points, and verified-winner trophy NFTs. Ghosts from other players need the winning jump log stored on-chain (or in an indexer).
