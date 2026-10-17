# Diorama Skirmish

**Play: https://crabtoast90-dev.github.io/practice-skirmish/** (add `?debug` for an FPS readout, `?seed=N` for a different fight)

A tiny tabletop autobattler: fantasy minis on a lamp-lit wooden board. Throwaway practice project for testing an agent build workflow on game *systems*: a deterministic headless combat sim with a balance report the designer tunes from. See `CLAUDE.md`, `PLAN.md` and `BALANCE.md`.

- Run locally: `npm install`, then `npm run dev`.
- Self-check: `npm run check`.
- Balance report: `npm run sim` (rewrites `BALANCE.md`). All tuning numbers are in `src/tuning.js`.
