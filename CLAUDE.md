# Diorama Skirmish

When the user asks for ideas, options, or a plan, give them that and stop.

## The game
A tiny autobattler: fantasy minis fight on a wooden board on a lamp-lit tabletop. Five rounds per sitting (~5-10 min): buy from a shop (3 offers, reroll, gold per round), place on your 3x5 half, watch the auto-battle against a scripted skeleton board. Round 5 is a boss. Three lives. Two copies merge into a 2-star. Units: Knight (tank), Barbarian (bruiser), Rogue (dives backline), Mage (area), Ranger (long range); enemies: Skeleton Warrior, Rogue, Mage, Minion. Each unit: HP, damage, attack speed, range, one special on a cooldown. No items, no traits. Anything beyond this goes in `IDEAS.md`, not the build.

The user is a game designer (League of Legends), not a programmer: report in plain language, no code. They make design and tuning calls; you make every technical call.

## How it's built
- **Sim first.** `src/sim/battle.js` is pure and deterministic (seeded RNG, no three.js, no DOM, no `Math.random`): same seed + boards = same fight. The 3D view (`src/view/`) only plays back what the sim returns. Never put game rules in the view.
- **All tuning numbers** (stats, specials, shop odds, gold, lives, enemy boards, balance targets) live in `src/tuning.js`. The user asks for changes by name; never hard-code a number elsewhere.
- **`npm run sim`** runs thousands of fights headlessly and rewrites `BALANCE.md` (headline, plain-words flags, tables, targets). Extend it whenever the sim gains something worth measuring. Rerun it after any tuning change and quote the headline back.
- Stack: three.js (pinned; API docs https://threejs.org/llms.txt), Vite, plain JS modules. Models in `public/models/` (KayKit CC0, from the committed `gltf/` source folder; move what you use, credit it in `CREDITS.md`, never fetch art from other sites).
- Test hooks: `?test` freezes the clock (the check advances it with `window.__game.advance(ms)`); `window.__game.stateText()` summarises state. Keep both working and extend them. `?seed=N` picks the fight seed. `?debug` shows FPS (the cloud has no GPU: screenshots prove the look, not speed).

## Self-check
`npm run check` builds, plays a scripted laptop and phone run headless, writes screenshots and `summary.txt` to `check-output/<timestamp>/` (last 5 kept, git-ignored). It fails on console errors, failed requests, a frozen state, or a browser fight that differs from the same fight simulated in Node. Add steps for every feature. `npm run check -- --url=https://crabtoast90-dev.github.io/practice-skirmish/` checks the live site. Before calling anything done, open the screenshots and say in one line what you see.

## Deploy and merge rule
Every push to `main` deploys to GitHub Pages: https://crabtoast90-dev.github.io/practice-skirmish/
Work on your own branch. When the check passes and you've opened the screenshots: rebase on main, rerun the check if main moved, merge to main, push. One merge at a time.

## Files to keep up to date
- `PLAN.md`: tick items when merged. `DECISIONS.md`: one dated line per user decision. `IDEAS.md`: parking lot for anything out of scope.
- `FRICTION.md`: when the user says "friction: ...", add a timestamped line.

## End of every session
Ask the user for their minutes (directing / reviewing / playing) and fresh fun and look scores 1-5. Never carry scores over from an earlier row. Then write the `LOG.md` row yourself (the user never edits it).
