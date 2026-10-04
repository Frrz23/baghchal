# बाघचाल (Baghchal) — AGENTS.md

Vite + TypeScript + SVG web app, wrapped with Capacitor 8 into an Android app
(`np.baghchal.game`). Nepali-primary UI with English toggle, vs-AI (minimax in a
Web Worker) + local two-player, 3 difficulties, sounds/animations, undo/history.

## Commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` (http://localhost:5173) |
| Typecheck | `npm run typecheck` |
| Unit tests (71) | `npm test` |
| UI smoke (needs dev server) | `npm run smoke` |
| Custom-game screen smoke | `npm run custom-smoke` (VW/VH env overrides viewport) |
| Responsive matrix (needs dev server) | `npm run responsive` |
| AI bias match (needs no server) | `npm run match` — env `MATCH_PRESET=classic\|speed\|fortress\|titan\|sudden`, `MATCH_RUNS=n` |
| Build | `npm run build` (tsc + vite build) |
| Sync + debug install (emulator) | `npm run emulator` then `npm run device` |
| On-device checks | `npm run appcheck` / `node scripts/uicheck.mjs [serial]` |
| Release (signed AAB+APK) | `npm run release` |
| Play screenshots | `npm run store-shots` |
| **Stop dev server + emulator** | **`npm run stop`** |

## RULE: always stop when done checking

**After finishing ANY check/test/build session, always run `npm run stop`.**
It closes the Vite dev server (port 5173), kills the emulator, and removes adb
forwards. Leaving them running heats the laptop badly. Never leave the dev
server or emulator running between tasks — run checks, then stop, every time.

## Verification ladder (before calling a change done)

1. `npm run typecheck`
2. `npm test`
3. `npm run dev` → `npm run responsive` + `npm run smoke` +
   `npm run custom-smoke` → `npm run stop`
4. Ruleset/AI changes: `npm run match` per preset (see `scripts/run-matches.ps1`)
   — tiger share must not regress beyond the classic baseline band
5. `npm run build` + `npx cap sync android` → install → `npm run appcheck` +
   `node scripts/uicheck.mjs emulator-5554`
6. `npm run device` (physical phone) → `node scripts/uicheck.mjs <serial>`
7. `npm run stop` — always last

## Gotchas

- **The installed app serves the bundled `dist/`** (no live reload). App changes
  need `npm run build` + `npx cap sync android` + reinstall; the dev server only
  drives smoke/responsive.
- `findDevice()` in `scripts/lib/adb.mjs` prefers the emulator — pass a serial
  explicitly for the phone.
- Release keystore lives outside the repo (`D:\JS\baghchal-keystore-backup\`);
  signing loads `android/keystore.properties` conditionally.
- versionCode 1 is spent on the first Play upload; every later upload bumps it
  (r1 → r2 …). Rule recorded in `store/listing.md`.
- `max(env(safe-area-inset-top), var(--safe-area-inset-top))` — env() and the
  Capacitor-injected var describe the SAME inset; never sum them.
- No `:has()` selectors: minSdk 24 (WebView ≈ Chromium 51 floor). Menu centering
  keys off `#app[data-screen='…']` set in `render()`.
- Scripts launch a fresh browser profile each run; the first-run tutorial is
  seeded/dismissed per script (see smoke/responsive/appcheck/uicheck/store-shots).
- Bash tool may flake on long runs: background with
  `Start-Process cmd /c "... > log"` + poll the log.
- **v1 parity rule**: `CLASSIC_RULESET` in `src/game/rules.ts` must stay
  byte-identical in behavior to v1 (the 31 pre-v2 tests are the guard).
  Share codes (`src/game/presets.ts`: `BC` + 5 chars) are player-facing —
  never change the format without invalidating old codes deliberately.
