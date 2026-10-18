# Diorama Skirmish

**Play: https://crabtoast90-dev.github.io/practice-skirmish/** (add `?debug` for an FPS readout, `?seed=N` for a different fight)

A tiny tabletop autobattler: fantasy minis on a lamp-lit wooden board. Throwaway practice project for testing an agent build workflow on game *systems*: a deterministic headless combat sim with a balance report the designer tunes from. See `CLAUDE.md`, `PLAN.md` and `BALANCE.md`.

## How to play

One sitting is five rounds against scripted skeleton boards; round 5 is a boss. You have three lives.

1. **Shop.** Each round pays gold and offers three units (Knight, Barbarian, Rogue, Mage, Ranger). Tap one to buy it, or reroll the offers for 1 gold.
2. **Place.** Tap a cell on your half (the near 3x5) to put the unit down. Tap a placed unit to pick it up and move it. A second copy of a unit merges into a stronger 2-star.
3. **Fight.** The battle plays itself. Every unit has one special on a cooldown (Shield Wall, Cleave, Shadow Leap, Fireball, Piercing Arrow; the skeletons have Heavy Blow, Backstab and Bone Burst).
4. **Result.** Losing a round costs a life and the run moves on to the next round either way. Finish round 5 with a life left for Victory; run out of lives for Defeat. Play again starts a fresh run.

Works on laptop (mouse) and phone (touch).

## For developers

- Run locally: `npm install`, then `npm run dev`.
- Self-check: `npm run check` (builds, plays scripted laptop and phone runs headless, screenshots to `check-output/`). `npm run check -- --url=https://crabtoast90-dev.github.io/practice-skirmish/` checks the live site.
- Test hooks: `?test` freezes the clock; `window.__game.stateText()` summarises the game.
- Code: `src/sim/battle.js` is the pure, seeded combat sim; `src/game/` holds the shop and run rules; `src/view/` only plays back what the sim decided.
- Balance report: `npm run sim` (rewrites `BALANCE.md`). All tuning numbers are in `src/tuning.js`.
