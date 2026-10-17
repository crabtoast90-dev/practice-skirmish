# Plan

Each item can be pasted alone into a fresh builder session. Every session reads `CLAUDE.md` first, follows the merge rule, adds steps to `npm run check` for what it builds, and reruns `npm run sim` if it touches the sim or tuning.

**Lanes:** items in different lanes touch different files and can run at the same time. Inside a lane, items run in order. "After X" means wait until X is merged.
**SHARED files:** `src/main.js`, `scripts/check.mjs`, `src/tuning.js` and `src/sim/battle.js` are touched by several items. Items list them when they touch them; two items that share a file can still run in parallel, but the second to merge must rebase and rerun the check.

## Setup (done 2026-10-17)
- [x] **0. Setup.** Scaffold, docs, lamp-lit board with one Knight and one Skeleton Warrior, deterministic sim with that fight played back in 3D, `npm run sim` → `BALANCE.md`, self-check, Pages deploy.

## Lane A: the sim (the point of this run)

- [x] **A1. Spacing and targeting.** (done 2026-10-17) Minis never stand in the same spot: they path around allies, take the nearest free cell in reach, and melee units spread around a target instead of queueing. Targeting stays "nearest enemy" for everyone except the Rogue's leap (A2). Files: `src/sim/battle.js` (SHARED), `scripts/sim.mjs`, `scripts/check.mjs` (SHARED) for a 3v3 playback step.
  *Done when:* `npm run sim` adds a "no two minis closer than 0.6 cells" sanity line that passes over 1000 random 5v5 fights; the check screenshots a 3v3 fight mid-battle with minis spread out; the browser fight still matches Node.

- [x] **A2. All specials.** (done 2026-10-17) After A1. Build the six missing specials as written in `src/tuning.js`: Barbarian Cleave, Rogue Shadow Leap (jumps to the enemy backline), Mage Fireball (area), Ranger Piercing Arrow, Skeleton Rogue Backstab, Skeleton Mage Bone Burst. Each emits a sim event the view can play. Flip `built: true`. Files: `src/sim/battle.js` (SHARED), `src/tuning.js` (SHARED, flags only, no number changes), `scripts/sim.mjs`.
  *Done when:* `BALANCE.md` lists no unbuilt specials and gains a "special check" table (each special fired at least once per fight on average, with its average damage or effect); determinism line still passes.

- [ ] **A3. Full balance report.** After A2. "Reasonable player boards": generate boards a sensible player could afford by each round from the gold curve and shop odds in tuning (front-liners in front, ranged behind, 2-stars when two copies are affordable), thousands per round. Report: win rate per unit in mixed boards, per 2-unit pair (grid), per round (clear rate rounds 1-5), average fight length, timeouts, and plain-word flags against the targets (unit above 60% / below 40%, a pair that always wins, a unit that never wins, fights outside 10-25 s, round 1 below ~95%, round 5 far from ~33%). Files: `scripts/sim.mjs`, new `src/sim/boards.js`, `src/tuning.js` (SHARED, add any generator knobs to the targets section only).
  *Done when:* `BALANCE.md` has all five sections filled with numbers, a top-of-file headline in plain words, and runs in under a minute.

- [ ] **A4. First tuning pass.** After A3. The user reads `BALANCE.md` and gives tuning calls by name; apply them in `src/tuning.js`, rerun, quote the new headline. Repeat per batch. Files: `src/tuning.js` (SHARED), `BALANCE.md`.
  *Done when:* each call is a dated line in `DECISIONS.md` and the headline is quoted back.

## Lane B: the game loop

- [x] **B1. Shop and placement.** Shop of 3 offers per round weighted by `economy.shopOdds`, reroll for `rerollCost`, gold display, buy, then tap a cell on your half to place (tap a placed unit to pick it up and move it). Two copies of the same 1-star merge into a 2-star automatically (shown with a star badge). Pure rules in new `src/game/shop.js` (seeded, no DOM, so the sim can reuse it); UI in new `src/view/shopUI.js`, `index.html`, `src/style.css`. Also `src/main.js` (SHARED), `scripts/check.mjs` (SHARED).
  *Done when:* the check buys two Knights (seeded shop), shows the 2-star merge, places three units, and screenshots the shop on laptop and phone; `stateText()` shows gold, offers and the board.

- [x] **B2. Five rounds, lives, win and lose.** After B1. Round flow: shop → place → Fight → result → next round with income. Enemy boards from `tuning.rounds`; losing a round costs a life; three lives; win all five = Victory screen, out of lives = Defeat screen, both with "play again". A round counter and lives pips. Files: new `src/game/run.js`, `src/view/shopUI.js`, `index.html`, `src/style.css`, `src/main.js` (SHARED), `scripts/check.mjs` (SHARED).
  *Done when:* the check plays a full seeded run to Victory and another to Defeat, screenshots each round result and both end screens; `stateText()` shows round, lives, gold.

## Lane C: minis on the board

- [x] **C1. All nine minis.** (merged 2026-10-17) Move Barbarian, Rogue, Mage, Ranger, Skeleton Rogue, Skeleton Mage and Skeleton Minion from `gltf/` to `public/models/units/` (plus `Rig_Medium_CombatRanged.glb` and `Rig_Medium_Special.glb` if used), map each to its attack and cast clips, credit them. Files: `src/view/units.js`, `public/models/units/`, `CREDITS.md`, `scripts/check.mjs` (SHARED, one screenshot with all nine lined up via a test hook).
  *Done when:* a check screenshot shows all nine minis standing on the board, each identifiable; no console errors.

- [ ] **C2. Specials and hits you can read.** After A2 and C1. Play back each special event: Shield Wall glow, Cleave arc, Rogue leap arc, Fireball projectile and burst, piercing arrow, Bone Burst; arrows and bolts fly for ranged attacks; a small hit flash and floating damage numbers. View only; the sim already decided. Files: `src/view/playback.js`, new `src/view/effects.js`.
  *Done when:* check screenshots catch at least four different specials mid-effect; the browser fight still matches Node.

## Lane D: the look (ONE session owns all of it)

- [x] **D1. Tabletop diorama look.** (merged 2026-10-17) Any time. Lighting first: warm lamp pool from one side with a visible lamp (simple model or Meshy), soft long shadows, a cool dim room; the board as a real wooden game board (bevelled frame, inlaid grid, slightly different wood for each half); round mini bases like painted figures; tilt-shift and grade tuned so it reads as miniatures on laptop and phone; HP bars styled to match; on phone the near board corners clip slightly, fix the framing. Files: `src/view/scene.js`, `src/view/post.js`, `src/style.css`, base meshes in `src/view/units.js` (coordinate with C1 if running in parallel), `CREDITS.md`.
  *Done when:* the check saves a 3-angle look sheet (`check-output/look-compare.png`) for laptop and a phone shot, and you describe each in one line; the user gives a look score.

## Ship

- [ ] **E1. Playtest fixes.** After the user's playtest. One session per batch of notes; each note becomes a line here first.
  *Done when:* each note is ticked with a screenshot or a BALANCE.md line that shows the fix.

- [ ] **E2. Release.** Last. Live-site check (`npm run check -- --url=https://crabtoast90-dev.github.io/practice-skirmish/`), README and CREDITS complete, LOG.md up to date, final `npm run sim`.
  *Done when:* the live-site check passes and its screenshots are described in one line each.
