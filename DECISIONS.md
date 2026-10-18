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
- 2026-10-17: Victory = finishing round 5 with at least one life left (win or lose round 5). Losing any round costs a life and moves you on; Defeat at 0 lives.
- 2026-10-17: A4 tuning: all four skeletons +50% HP, damage, attack speed and special damage (Bone Burst 120 → 180); range, move speed and cooldowns unchanged.
- 2026-10-17: A4 tuning: Mage +30% HP, damage, attack speed and Fireball damage (450 HP, 40 dmg, 0.7/s, 160 → 585, 52, 0.91/s, 208); range, move speed and cooldown unchanged.
- 2026-10-17: A4 tuning: all four skeletons another +75% on top of the +50% (HP, damage, attack speed, Bone Burst damage; about 2.6x the original HP, damage and attack speed, rounded); range, move speed and cooldowns unchanged.
- 2026-10-17: A4 tuning: all four skeletons -35% from the last setting (HP, damage, attack speed, Bone Burst damage; about 1.7x the original, rounded); range, move speed and cooldowns unchanged.
- 2026-10-17: A4 tuning: all four skeletons +18% from the last setting (HP, damage, attack speed, Bone Burst damage; about 2.0x the original, rounded); range, move speed and cooldowns unchanged.
- 2026-10-18: Tuning closed as it stands; Shield Wall rarely firing before a 1-star Knight dies is accepted, no change.
- 2026-10-18: Skip E1 (playtest fixes): the user has tested enough and doesn't want a polish pass; go straight to E2 release.
- 2026-10-18: Projection paint-over trialed (look experiment, behind ?look=painted; lit stays the default). Result: painted definitely looks better, though not drastically: more detailed, same overall aesthetic. Lit stays the default for now.
- 2026-10-18: Projection paint-over documented as a reusable look workflow for fixed-camera games (PAINTOVER.md).
