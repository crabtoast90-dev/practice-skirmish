# Decisions

One dated line per decision the user makes.

- 2026-10-17: Game is "Diorama Skirmish": a 5-round tabletop autobattler (shop, 3x5 placement, auto-battle vs scripted skeleton boards, round 5 boss, 3 lives, 2-star merges, one special per unit, no items or traits).
- 2026-10-17: Roster is the five free KayKit Adventurers (Knight tank, Barbarian bruiser, Rogue backline diver, Mage area damage, Ranger long range) vs the four free KayKit Skeletons (Warrior, Rogue, Mage, Minion).
- 2026-10-17: Combat runs in a pure deterministic sim, separate from rendering; all tuning numbers in one data file; `npm run sim` writes BALANCE.md.
- 2026-10-17: Starting balance targets: fights 10-25 s; no unit above ~60% or below ~40% in mixed boards; a reasonable board clears round 1 almost always and round 5 about a third of the time.
- 2026-10-17: Look is a lamp-lit tabletop diorama (warm side light, wooden gridded board, soft shadows, slight tilt-shift); lighting first; the look is one item owned by one session.
- 2026-10-17: Stack and workflow copied from practice-glade (three.js pinned, Vite, Pages on push to main, `npm run check`).
- 2026-10-17: LOG.md drops the directing / reviewing / playing minutes. It tracks three times instead: Claude working on any prompt; the user replying within 20 minutes of Claude finishing; and both together as real time. Time when several sessions overlap counts once.
- 2026-10-17: Look feedback after D1: "too dark" — brightened the lamp pool, room fill, exposure and vignette (scores 1.6 fun / 2.2 look, unchanged after brightening).
- 2026-10-17: Until the five-round run (B2) exists, each new shop after a fight counts as the next round: it pays that round's income and uses its shop odds; past round 5 it keeps paying round 5's income.
- 2026-10-17: Losing a round costs a life and the run moves on to the next round (no replaying the lost round). Replacing B2's "replay the round".
- 2026-10-17: "Retry pays income again" is void: there are no retries any more, so each round pays its income once.
- 2026-10-17: No board-size cap beyond the 15 cells of your half. Round 5 difficulty must come from tuning (A4), not a unit limit.
