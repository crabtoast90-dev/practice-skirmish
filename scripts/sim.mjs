// npm run sim: run thousands of battles headlessly and write BALANCE.md.
// The main report runs "reasonable player boards" (src/sim/boards.js) against
// each round's skeletons and against each other: per-unit and per-pair win
// rates, per-round clear rates, fight length, timeouts. Below that: the
// Knight vs Skeleton Warrior duel, the special check, whole bot runs, the
// shop's odds and sim health.
import { writeFileSync } from 'node:fs';
import { TUNING } from '../src/tuning.js';
import { simulate, makeRng, COLS, ROWS_PER_SIDE } from '../src/sim/battle.js';
import { rollOffers } from '../src/game/shop.js';
import { createRun } from '../src/game/run.js';
import { botShop } from '../src/game/bot.js';
import { reasonableBoards } from '../src/sim/boards.js';

const SEEDS_PER_PLACEMENT = Number(process.argv.find((a) => a.startsWith('--seeds='))?.slice(8) ?? 10);
const OUT = 'BALANCE.md';
const started = Date.now();

const cells = [];
for (let row = 0; row < ROWS_PER_SIDE; row++) for (let col = 0; col < COLS; col++) cells.push({ row, col });

function duel(a, b, aStar = 1, bStar = 1) {
  const fights = [];
  let seed = 1;
  for (const pc of cells) {
    for (const ec of cells) {
      for (let s = 0; s < SEEDS_PER_PLACEMENT; s++) {
        const r = simulate(TUNING, [{ unit: a, star: aStar, ...pc }], [{ unit: b, star: bStar, ...ec }], seed++, { record: false });
        fights.push({ pc, ec, ...r });
      }
    }
  }
  return fights;
}

const pct = (n) => `${Math.round(n * 100)}%`;
const pct1 = (n) => `${(n * 100).toFixed(1)}%`; // for numbers judged against a band edge
const sec = (n) => `${n.toFixed(1)} s`;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);

function summarise(label, fights, playerName, enemyName) {
  const n = fights.length;
  const wins = fights.filter((f) => f.winner === 'player');
  const losses = fights.filter((f) => f.winner === 'enemy');
  const draws = fights.filter((f) => f.timedOut);
  const durations = fights.map((f) => f.duration).sort((x, y) => x - y);
  const winnerHpLeft = mean(fights.filter((f) => !f.timedOut).map((f) => f.survivors[0].hp / (f.winner === 'player' ? f.units[0].maxHp : f.units[1].maxHp)));
  const byRow = [0, 1, 2].map((row) => {
    const fs = fights.filter((f) => f.pc.row === row);
    return fs.filter((f) => f.winner === 'player').length / fs.length;
  });
  return {
    label, n, playerName, enemyName,
    winRate: wins.length / n,
    lossRate: losses.length / n,
    drawRate: draws.length / n,
    avg: mean(durations),
    p10: durations[Math.floor(n * 0.1)],
    p90: durations[Math.floor(n * 0.9)],
    min: durations[0],
    max: durations[n - 1],
    winnerHpLeft,
    byRow,
  };
}

// Determinism: replay a sample with full recording and compare to a second run.
function determinismCheck() {
  for (let seed = 1; seed <= 200; seed++) {
    const p = [{ unit: 'knight', row: seed % 3, col: seed % 5 }];
    const e = [{ unit: 'skeletonWarrior', row: (seed * 7) % 3, col: (seed * 3) % 5 }];
    const a = JSON.stringify(simulate(TUNING, p, e, seed));
    const b = JSON.stringify(simulate(TUNING, p, e, seed));
    if (a !== b) return { ok: false, seed };
  }
  return { ok: true, count: 200 };
}

// Spacing: random 5v5 boards (any units, any free cells, some 2-stars), recorded
// tick by tick, measuring the closest two living minis ever get.
const SPACING_FIGHTS = 1000;
const MIN_SPACING = 0.6;
function randomBoard(rng, keys) {
  const free = cells.map((c) => ({ ...c }));
  const board = [];
  for (let i = 0; i < 5; i++) {
    const c = free.splice(Math.floor(rng() * free.length), 1)[0];
    board.push({ unit: keys[Math.floor(rng() * keys.length)], star: rng() < 0.2 ? 2 : 1, ...c });
  }
  return board;
}
function spacingCheck() {
  const rng = makeRng(12345);
  const playerKeys = Object.keys(TUNING.units);
  const enemyKeys = Object.keys(TUNING.enemies);
  let closest = Infinity;
  let worst = null;
  let tooClose = 0;
  const durations = [];
  let timeouts = 0;
  let nondeterministic = null;
  const specials = {}; // unit key -> { copies, casts, damage, blocked, dealt }
  for (let i = 0; i < SPACING_FIGHTS; i++) {
    const p = randomBoard(rng, playerKeys);
    const e = randomBoard(rng, enemyKeys);
    const seed = 100000 + i;
    const r = simulate(TUNING, p, e, seed);
    if (i < 50 && JSON.stringify(r) !== JSON.stringify(simulate(TUNING, p, e, seed))) nondeterministic = seed;
    durations.push(r.duration);
    if (r.timedOut) timeouts++;
    for (const u of r.units) {
      const sp = (specials[u.unit] ??= { copies: 0, casts: 0, damage: 0, blocked: 0, dealt: 0 });
      sp.copies += 1;
      sp.casts += u.casts;
      sp.damage += u.specialDamage;
      sp.blocked += u.blocked;
      sp.dealt += u.damageDealt;
    }
    let fightClosest = Infinity;
    for (const fr of r.frames) {
      for (let a = 0; a < fr.length; a++) {
        if (fr[a][2] <= 0) continue;
        for (let b = a + 1; b < fr.length; b++) {
          if (fr[b][2] <= 0) continue;
          const d = Math.hypot(fr[a][0] - fr[b][0], fr[a][1] - fr[b][1]);
          if (d < fightClosest) fightClosest = d;
        }
      }
    }
    if (fightClosest < MIN_SPACING) tooClose++;
    if (fightClosest < closest) { closest = fightClosest; worst = seed; }
  }
  return { n: SPACING_FIGHTS, specials, nondeterministic, closest, worst, tooClose, ok: tooClose === 0, avg: mean(durations), timeouts };
}

const matchups = [
  summarise('1-star vs 1-star', duel('knight', 'skeletonWarrior'), 'Knight', 'Skeleton Warrior'),
  summarise('2-star Knight vs 1-star', duel('knight', 'skeletonWarrior', 2, 1), 'Knight (2-star)', 'Skeleton Warrior'),
];
const det = determinismCheck();
const spacing = spacingCheck();
if (det.ok && spacing.nondeterministic !== null) Object.assign(det, { ok: false, seed: spacing.nondeterministic });
const total = () => matchups.reduce((s, m) => s + m.n, 0) + spacing.n + reasonableFights + runStats.fights * RUNS;
const tg = TUNING.targets;

// Flags in plain words.
// Whole runs: the simple bot (src/game/bot.js) plays complete seeded sittings.
// It buys merges first, then anything it can afford, rerolls while it has spare
// gold, tanks in front, ranged at the back. Not a great player, not a bad one.
const RUNS = 1000;
const runStats = (() => {
  const nRounds = TUNING.rounds.length;
  const tries = Array(nRounds).fill(0);
  const firstTry = Array(nRounds).fill(0);
  const reached = Array(nRounds).fill(0);
  let victories = 0;
  let livesLeft = 0;
  let fights = 0;
  let units = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const run = createRun(TUNING, seed);
    const seen = new Set();
    while (run.state.phase === 'shop') {
      const r = run.state.round;
      if (!seen.has(r)) { seen.add(r); reached[r - 1] += 1; }
      botShop(TUNING, run.shop);
      const first = run.state.history.every((h) => h.round !== r);
      run.fight({ record: false });
      tries[r - 1] += 1;
      if (first && run.state.last.won) firstTry[r - 1] += 1;
      run.next();
    }
    fights += run.state.history.length;
    units += run.shop.state.board.length;
    if (run.state.phase === 'victory') { victories += 1; livesLeft += run.state.lives; }
  }
  return { nRounds, tries, firstTry, reached, victory: victories / RUNS, livesLeft: livesLeft / (victories || 1), fights: fights / RUNS, units: units / RUNS };
})();
const firstTryRate = (i) => runStats.firstTry[i] / (runStats.reached[i] || 1);

// Reasonable player boards: thousands of sensible players shop through every
// round with the real shop. Each round's board fights that round's skeletons
// (clear rate) and the next player's board from the same round (head-to-head
// at equal gold: each board fights once on each side, so 50% is even). Unit
// and pair win rates come from head-to-head, where the 40-60% band means something.
const GEN = tg.boardGen;
const playerKeys = Object.keys(TUNING.units);
const unitName = (k) => TUNING.units[k].name;
const pairId = (a, b) => (playerKeys.indexOf(a) <= playerKeys.indexOf(b) ? `${a}+${b}` : `${b}+${a}`);
const tally = () => ({ n: 0, score: 0 });
const add = (t, score) => { t.n += 1; t.score += score; };
const rate = (t) => t.score / (t.n || 1);
const lengthStats = (fs) => {
  const d = fs.map((f) => f.duration).sort((x, y) => x - y);
  const n = d.length;
  return {
    n, avg: mean(d), p10: d[Math.floor(n * 0.1)], p90: d[Math.floor(n * 0.9)],
    short: d.filter((x) => x < tg.fightSeconds[0]).length / n,
    long: d.filter((x) => x > tg.fightSeconds[1]).length / n,
    timeouts: fs.filter((f) => f.timedOut).length,
  };
};
const genStarted = Date.now();
const boardsByRound = reasonableBoards(TUNING, GEN.boardsPerRound, { seed: 1 });
const unitH2H = Object.fromEntries(playerKeys.map((k) => [k, tally()]));
const pairH2H = {};
const unitPve = Object.fromEntries(playerKeys.map((k) => [k, TUNING.rounds.map(() => tally())]));
const reasonable = boardsByRound.map((boards, i) => {
  const n = boards.length;
  const pve = boards.map((b, j) => simulate(TUNING, b.board, TUNING.rounds[i].board, 500000 + i * 10000 + j, { record: false }));
  const h2h = boards.map((b, j) => simulate(TUNING, b.board, boards[(j + 1) % n].board, 700000 + i * 10000 + j, { record: false }));
  const sideScore = (r, side) => (r.winner === 'draw' ? 0.5 : r.winner === side ? 1 : 0);
  boards.forEach((b, j) => {
    const types = [...new Set(b.board.map((u) => u.unit))];
    const twoStars = b.board.filter((u) => u.star === 2).map((u) => u.unit);
    const cleared = pve[j].winner === 'player' ? 1 : 0;
    for (const score of [sideScore(h2h[j], 'player'), sideScore(h2h[(j - 1 + n) % n], 'enemy')]) {
      for (const a of types) add(unitH2H[a], score);
      for (let x = 0; x < types.length; x++) for (let y = x + 1; y < types.length; y++) add((pairH2H[pairId(types[x], types[y])] ??= tally()), score);
      for (const a of twoStars) add((pairH2H[pairId(a, a)] ??= tally()), score);
    }
    for (const a of types) add(unitPve[a][i], cleared);
  });
  return {
    round: i + 1, name: TUNING.rounds[i].name, n,
    units: mean(boards.map((b) => b.board.length)),
    twoStars: mean(boards.map((b) => b.board.filter((u) => u.star === 2).length)),
    spent: mean(boards.map((b) => b.spent)),
    clear: pve.filter((r) => r.winner === 'player').length / n,
    pve: lengthStats(pve),
    h2h: lengthStats(h2h),
  };
});
const reasonableSeconds = (Date.now() - genStarted) / 1000;
const reasonableFights = reasonable.reduce((s, r) => s + r.pve.n + r.h2h.n, 0);
const unitRows = playerKeys.map((k) => {
  const rounds = unitPve[k].filter((t) => t.n > 0);
  const boardsWith = unitPve[k].reduce((s, t) => s + t.n, 0);
  return { k, name: unitName(k), h2h: rate(unitH2H[k]), n: unitH2H[k].n, share: boardsWith / (GEN.boardsPerRound * TUNING.rounds.length), pve: mean(rounds.map(rate)) };
}).sort((a, b) => b.h2h - a.h2h);
const PAIR_MIN = 100; // fewer board appearances than this: too few to judge
const pairCell = (t) => (t && t.n >= PAIR_MIN ? pct(rate(t)) : '-');
const pairRows = Object.entries(pairH2H).map(([id, t]) => {
  const [a, b] = id.split('+');
  return { a, b, name: a === b ? `2-star ${unitName(a)}` : `${unitName(a)} + ${unitName(b)}`, rate: rate(t), n: t.n };
});
const pveAvg = mean(reasonable.map((r) => r.pve.avg));
const h2hAvg = mean(reasonable.map((r) => r.h2h.avg));
const pveTimeouts = reasonable.reduce((s, r) => s + r.pve.timeouts, 0);
const h2hTimeouts = reasonable.reduce((s, r) => s + r.h2h.timeouts, 0);
const r1 = reasonable[0];
const r5 = reasonable[reasonable.length - 1];

const flags = [];
// Reasonable-board flags first: they're the ones that judge the targets.
for (const u of unitRows) {
  if (u.h2h < tg.unitNeverWins) flags.push(`${u.name} basically never wins: boards with one win ${pct1(u.h2h)} head-to-head.`);
  else if (u.h2h > tg.unitWinRate[1]) flags.push(`${u.name} is too strong: boards with one win ${pct1(u.h2h)} head-to-head (target ${pct(tg.unitWinRate[0])}-${pct(tg.unitWinRate[1])}).`);
  else if (u.h2h < tg.unitWinRate[0]) flags.push(`${u.name} is too weak: boards with one win ${pct1(u.h2h)} head-to-head (target ${pct(tg.unitWinRate[0])}-${pct(tg.unitWinRate[1])}).`);
}
for (const p of pairRows.filter((q) => q.n >= PAIR_MIN && q.rate > tg.pairWinRateMax).sort((x, y) => y.rate - x.rate)) {
  flags.push(`${p.name} nearly always wins: ${pct(p.rate)} head-to-head over ${p.n} boards (flag above ${pct(tg.pairWinRateMax)}).`);
}
if (r1.clear < tg.round1ClearRate) flags.push(`Only ${pct1(r1.clear)} of reasonable boards clear round 1 (target ~${pct(tg.round1ClearRate)}).`);
if (Math.abs(r5.clear - tg.round5ClearRate) > tg.round5Tolerance) {
  flags.push(`${pct(r5.clear)} of reasonable boards beat the round 5 boss (target ~${pct(tg.round5ClearRate)}): ${r5.clear > tg.round5ClearRate ? 'the boss is too easy' : 'the boss is too hard'} for what ${Math.round(r5.spent)} gold buys (${r5.units.toFixed(1)} units, ${r5.twoStars.toFixed(1)} of them 2-stars).`);
}
const easyRounds = reasonable.slice(1, -1).filter((r) => r.clear > 0.98).map((r) => r.round);
if (easyRounds.length) flags.push(`Round${easyRounds.length > 1 ? 's' : ''} ${easyRounds.join(', ')} ${easyRounds.length > 1 ? 'are' : 'is'} cleared by nearly every reasonable board, so they don't threaten a life.`);
for (const r of reasonable) {
  if (r.pve.avg < tg.fightSeconds[0]) flags.push(`${r.name} fights are too short: ${sec(r.pve.avg)} on average (target ${tg.fightSeconds[0]}-${tg.fightSeconds[1]} s).`);
  if (r.pve.avg > tg.fightSeconds[1]) flags.push(`${r.name} fights drag: ${sec(r.pve.avg)} on average (target ${tg.fightSeconds[0]}-${tg.fightSeconds[1]} s).`);
  if (r.h2h.avg < tg.fightSeconds[0]) flags.push(`Head-to-head fights at round ${r.round} gold are too short: ${sec(r.h2h.avg)} on average.`);
  if (r.h2h.avg > tg.fightSeconds[1]) flags.push(`Head-to-head fights at round ${r.round} gold drag: ${sec(r.h2h.avg)} on average.`);
}
if (pveTimeouts) flags.push(`${pveTimeouts} reasonable-board fights against the skeletons timed out at ${TUNING.combat.timeoutSeconds} s (a timeout costs the player a life).`);
if (h2hTimeouts) flags.push(`${h2hTimeouts} head-to-head fights timed out at ${TUNING.combat.timeoutSeconds} s.`);
for (const m of matchups) {
  if (m.avg < tg.fightSeconds[0]) flags.push(`${m.playerName} vs ${m.enemyName}: fights are too short (average ${sec(m.avg)}, target ${tg.fightSeconds[0]}-${tg.fightSeconds[1]} s).`);
  if (m.avg > tg.fightSeconds[1]) flags.push(`${m.playerName} vs ${m.enemyName}: fights drag (average ${sec(m.avg)}, target ${tg.fightSeconds[0]}-${tg.fightSeconds[1]} s).`);
  if (m.drawRate > 0) flags.push(`${m.playerName} vs ${m.enemyName}: ${pct(m.drawRate)} of fights time out at ${TUNING.combat.timeoutSeconds} s with both alive.`);
  if (m.winRate === 1 && !m.label.startsWith('2-star')) flags.push(`${m.playerName} never loses to a ${m.enemyName} — the duel has no counterplay.`);
  if (m.winRate === 0) flags.push(`${m.playerName} never beats a ${m.enemyName}.`);
}
const base = matchups[0];
if (!spacing.ok) flags.push(`MINIS OVERLAP: in ${spacing.tooClose} of ${spacing.n} random 5v5 fights two living minis came closer than ${MIN_SPACING} cells (closest ${spacing.closest.toFixed(2)}, seed ${spacing.worst}).`);
const allUnits = { ...TUNING.units, ...TUNING.enemies };
const specialRows = Object.entries(allUnits).map(([k, u]) => {
  const st = spacing.specials[k] ?? { copies: 0, casts: 0, damage: 0, blocked: 0, dealt: 0 };
  const sp = u.special;
  const perFight = st.casts / (st.copies || 1);
  let effect;
  if (sp.kind === 'none') effect = 'no special (fodder)';
  else if (!sp.built) effect = 'not built';
  else if (sp.kind === 'shieldWall') effect = `blocks ${Math.round(st.blocked / (st.casts || 1))} damage per cast (takes ${pct(sp.damageTaken)} damage for ${sp.duration} s)`;
  else if (sp.kind === 'leapBackline') effect = `jumps beside the enemy furthest back; the Rogue then deals ${Math.round(st.dealt / (st.copies || 1))} damage per fight`;
  else {
    const what = { heavyBlow: `next hit x${sp.multiplier}`, cleave: `next hit x${sp.multiplier} on the target and everyone within ${sp.radius} cell of it`, pierce: `next hit x${sp.multiplier} on everyone in the arrow's line`, areaBlast: `${sp.damage} damage to the target and everyone within ${sp.radius} cell of it` }[sp.kind];
    effect = `${Math.round(st.damage / (st.casts || 1))} damage per cast (${what})`;
  }
  return { k, u, sp, st, perFight, effect };
});
for (const r of specialRows) {
  if (r.sp.kind === 'none') continue;
  if (!r.sp.built) flags.push(`${r.u.name}'s ${r.sp.name} isn't built in the sim yet.`);
  else if (r.perFight < 1) flags.push(`${r.u.name}'s ${r.sp.name} goes off only ${r.perFight.toFixed(2)} times per fight on average (wanted at least 1).`);
}
if (spacing.timeouts) flags.push(`${spacing.timeouts} of ${spacing.n} random 5v5 fights timed out at ${TUNING.combat.timeoutSeconds} s (random boards, so a hint only).`);
if (!det.ok) flags.push(`DETERMINISM BROKEN: seed ${det.seed} gave two different results. Nothing else in this file can be trusted until that's fixed.`);

const headline = (() => {
  const best = unitRows[0];
  const worst = unitRows[unitRows.length - 1];
  const verdict = [];
  if (r5.clear > tg.round5ClearRate + tg.round5Tolerance) verdict.push('the skeletons are too easy');
  if (r5.clear < tg.round5ClearRate - tg.round5Tolerance) verdict.push('the boss is too hard');
  if (r1.clear < tg.round1ClearRate) verdict.push('round 1 is too hard');
  if (best.h2h > tg.unitWinRate[1]) verdict.push(`${best.name} is too strong`);
  if (worst.h2h < tg.unitWinRate[0]) verdict.push(`${worst.name} is too weak`);
  if (pveAvg < tg.fightSeconds[0]) verdict.push('fights against them are over too fast');
  if (pveAvg > tg.fightSeconds[1]) verdict.push('fights against them drag');
  const sentence = verdict.length ? `In short: ${verdict.join(', ')}.` : 'In short: everything is on target.';
  return [
    `${sentence} Reasonable player boards clear round 1 **${pct1(r1.clear)}** of the time (target ~${pct(tg.round1ClearRate)}) and beat the round 5 boss **${pct(r5.clear)}** (target ~${pct(tg.round5ClearRate)}).`,
    `Head-to-head at equal gold the strongest unit is the **${best.name} (${pct1(best.h2h)})** and the weakest the **${worst.name} (${pct1(worst.h2h)})** (target ${pct(tg.unitWinRate[0])}-${pct(tg.unitWinRate[1])}).`,
    `Fights against the skeletons average **${sec(pveAvg)}** (target ${tg.fightSeconds[0]}-${tg.fightSeconds[1]} s) with ${pveTimeouts} timeouts.`,
  ].join(' ');
})();

const row = (m) =>
  `| ${m.label} | ${m.n} | ${pct(m.winRate)} | ${pct(m.lossRate)} | ${pct(m.drawRate)} | ${sec(m.avg)} | ${sec(m.p10)}-${sec(m.p90)} | ${pct(m.winnerHpLeft)} |`;

// Shop: roll each round's offers many times with the real shop code.
const SHOP_ROLLS = 20000;
const shopUnits = Object.keys(TUNING.economy.shopOdds);
const shopRounds = TUNING.economy.incomePerRound.map((_, i) => {
  const rng = makeRng(1000 + i);
  const seen = Object.fromEntries(shopUnits.map((u) => [u, 0]));
  let pair = 0;
  for (let n = 0; n < SHOP_ROLLS; n++) {
    const o = rollOffers(TUNING, i + 1, rng);
    for (const u of new Set(o)) seen[u] += 1;
    if (o.some((u, j) => o.indexOf(u) !== j)) pair += 1;
  }
  return { round: i + 1, seen, pair: pair / SHOP_ROLLS };
});
const eco = TUNING.economy;
let goldSoFar = eco.startingGold;
const goldByRound = eco.incomePerRound.map((g) => (goldSoFar += g));

const md = [
  '# Balance report',
  '',
  `Generated by \`npm run sim\` on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from the numbers in \`src/tuning.js\`. ${total()} fights in ${((Date.now() - started) / 1000).toFixed(1)} s. Don't edit by hand; rerun the sim.`,
  '',
  '## Headline',
  '',
  headline,
  '',
  '## Flags',
  '',
  ...(flags.length ? flags.map((f) => `- ${f}`) : ['- Nothing out of line.']),
  '',
  `## 1. Unit win rates (reasonable boards)`,
  '',
  `${GEN.boardsPerRound} sensible players shop through all ${TUNING.rounds.length} rounds with the real shop (gold, offers and odds from tuning). They buy a merge whenever one shows up, otherwise any offer they can afford, sometimes reroll instead (chance ${pct(GEN.rerollChance)}, up to ${GEN.maxRerollsPerRound} a round), and spend down every round. Tanks and bruisers stand in front, the Rogue in the middle, Mage and Ranger at the back. That gives ${GEN.boardsPerRound} boards per round.`,
  '',
  `"Head-to-head" puts each board against another player's board from the same round (same gold), once on each side: 50% is even, the target band is ${pct(tg.unitWinRate[0])}-${pct(tg.unitWinRate[1])}. A unit's number is how often boards that have it win. "Clears skeletons" is the share of boards with it that beat that round's skeleton board, averaged over rounds.`,
  '',
  '| unit | cost | on how many boards | head-to-head win rate | clears skeletons |',
  '| --- | --- | --- | --- | --- |',
  ...unitRows.map((u) => `| ${u.name} | ${TUNING.units[u.k].cost} | ${pct(u.share)} | ${pct1(u.h2h)} | ${pct(u.pve)} |`),
  '',
  '## 2. Pairs (head-to-head)',
  '',
  `How often a board with both units wins head-to-head. The diagonal is a board with that unit as a 2-star. "-" = fewer than ${PAIR_MIN} boards to judge from. Flagged above ${pct(tg.pairWinRateMax)}.`,
  '',
  `| | ${playerKeys.map(unitName).join(' | ')} |`,
  `| --- | ${playerKeys.map(() => '---').join(' | ')} |`,
  ...playerKeys.map((a) => `| **${unitName(a)}** | ${playerKeys.map((b) => pairCell(pairH2H[pairId(a, b)])).join(' | ')} |`),
  '',
  `Strongest pairs: ${pairRows.filter((p) => p.n >= PAIR_MIN && p.a !== p.b).sort((x, y) => y.rate - x.rate).slice(0, 3).map((p) => `${p.name} ${pct(p.rate)}`).join(', ')}. Weakest: ${pairRows.filter((p) => p.n >= PAIR_MIN && p.a !== p.b).sort((x, y) => x.rate - y.rate).slice(0, 3).map((p) => `${p.name} ${pct(p.rate)}`).join(', ')}.`,
  '',
  '## 3. Rounds (reasonable boards vs the skeletons)',
  '',
  'Each round\'s boards fight that round\'s scripted skeleton board once. A player who never loses a round would have this board.',
  '',
  '| round | gold spent so far | units on board | of them 2-stars | clears it |',
  '| --- | --- | --- | --- | --- |',
  ...reasonable.map((r) => `| ${r.name} | ${r.spent.toFixed(1)} | ${r.units.toFixed(1)} | ${r.twoStars.toFixed(1)} | ${pct(r.clear)} |`),
  '',
  '## 4. Fight length',
  '',
  `Target ${tg.fightSeconds[0]}-${tg.fightSeconds[1]} s. "Too short" / "too long" = share of fights outside that band.`,
  '',
  '| round | vs skeletons: average | middle 80% | too short | too long | head-to-head: average | middle 80% | too short | too long |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...reasonable.map((r) => `| ${r.name} | ${sec(r.pve.avg)} | ${sec(r.pve.p10)}-${sec(r.pve.p90)} | ${pct(r.pve.short)} | ${pct(r.pve.long)} | ${sec(r.h2h.avg)} | ${sec(r.h2h.p10)}-${sec(r.h2h.p90)} | ${pct(r.h2h.short)} | ${pct(r.h2h.long)} |`),
  '',
  `All rounds: ${sec(pveAvg)} against the skeletons, ${sec(h2hAvg)} head-to-head.`,
  '',
  '## 5. Timeouts',
  '',
  `A fight still going at ${TUNING.combat.timeoutSeconds} s is a draw, which costs the player a life.`,
  '',
  '| round | vs skeletons | head-to-head |',
  '| --- | --- | --- |',
  ...reasonable.map((r) => `| ${r.name} | ${r.pve.timeouts} of ${r.pve.n} | ${r.h2h.timeouts} of ${r.h2h.n} |`),
  '',
  `The reasonable-board report (${reasonableFights} fights) took ${reasonableSeconds.toFixed(1)} s.`,
  '',
  '## Knight vs Skeleton Warrior',
  '',
  `Every placement of each unit on its own half (15 x 15 = 225 pairings) x ${SEEDS_PER_PLACEMENT} seeds. "Winner HP left" is how healthy the survivor ends, as a share of its max HP.`,
  '',
  '| matchup | fights | Knight wins | Knight loses | timeouts | avg length | middle 80% | winner HP left |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...matchups.map(row),
  '',
  `Knight's win rate by the row it starts in (1-star duel): front ${pct(base.byRow[0])}, middle ${pct(base.byRow[1])}, back ${pct(base.byRow[2])}.`,
  '',
  'Current numbers in play:',
  '',
  ...['knight', 'skeletonWarrior'].map((k) => {
    const u = TUNING.units[k] ?? TUNING.enemies[k];
    const s = u.special;
    const extra = s.kind === 'shieldWall' ? `takes ${pct(s.damageTaken)} damage for ${s.duration} s` : `next hit x${s.multiplier}`;
    return `- ${u.name}: ${u.hp} HP, ${u.damage} damage, ${u.attackSpeed} attacks/s (${Math.round(u.damage * u.attackSpeed)} damage per second), range ${u.range}, moves ${u.moveSpeed} cells/s. Special: ${s.name} every ${s.cooldown} s (${extra}).`;
  }),
  '',
  '## Special check',
  '',
  `From the ${spacing.n} random 5v5 fights (any units, any cells, 1 in 5 a 2-star). "Per fight" is per copy of that unit on the board. Damage counts what landed, after Shield Wall.`,
  '',
  '| unit | special | cooldown | goes off per fight | effect |',
  '| --- | --- | --- | --- | --- |',
  ...specialRows.map((r) => `| ${r.u.name} | ${r.sp.name} | ${r.sp.kind === 'none' ? '-' : `${r.sp.cooldown} s${r.sp.firstAt ? ` (first at ${r.sp.firstAt * r.sp.cooldown} s)` : ''}`} | ${r.sp.kind === 'none' ? '-' : r.perFight.toFixed(2)} | ${r.effect} |`),
  '',
  '## Whole runs',
  '',
  `${RUNS} complete sittings played by the simple bot (buys merges first, then anything it can afford, rerolls spare gold, tanks in front, ranged behind). Lose a round = lose a life and replay it; clear all ${runStats.nRounds} = Victory; ${TUNING.economy.lives} lives.`,
  '',
  `- Victory in **${pct(runStats.victory)}** of runs (with ${runStats.livesLeft.toFixed(1)} lives left on average when it wins); ${runStats.fights.toFixed(1)} fights per run; ${runStats.units.toFixed(1)} units on the board at the end.`,
  '',
  '| round | runs that got there | cleared first try | fights played there |',
  '| --- | --- | --- | --- |',
  ...TUNING.rounds.map((r, i) => `| ${r.name} | ${pct(runStats.reached[i] / RUNS)} | ${pct(firstTryRate(i))} | ${runStats.tries[i]} |`),
  '',
  '## Shop',
  '',
  `${SHOP_ROLLS} rolls of ${eco.offersPerRound} offers per round from \`src/game/shop.js\`. "Shows up" = at least one copy in a fresh roll; "a pair" = two of the same unit in one roll (buy both for an instant 2-star). Reroll costs ${eco.rerollCost} gold.`,
  '',
  `| round | gold if you saved it all | ${shopUnits.map((u) => `${TUNING.units[u].name} shows up`).join(' | ')} | a pair |`,
  `| --- | --- | ${shopUnits.map(() => '---').join(' | ')} | --- |`,
  ...shopRounds.map((r, i) => `| ${r.round} | ${goldByRound[i]} | ${shopUnits.map((u) => pct(r.seen[u] / SHOP_ROLLS)).join(' | ')} | ${pct(r.pair)} |`),
  '',
  '## Targets',
  '',
  '| target | wanted | now |',
  '| --- | --- | --- |',
  `| fight length | ${tg.fightSeconds[0]}-${tg.fightSeconds[1]} s | ${sec(pveAvg)} vs skeletons, ${sec(h2hAvg)} head-to-head (reasonable boards) |`,
  `| unit win rate in mixed boards | ${pct(tg.unitWinRate[0])}-${pct(tg.unitWinRate[1])} | ${pct1(unitRows[unitRows.length - 1].h2h)} (${unitRows[unitRows.length - 1].name}) to ${pct1(unitRows[0].h2h)} (${unitRows[0].name}) head-to-head |`,
  `| no pair above | ${pct(tg.pairWinRateMax)} | best ${(() => { const p = pairRows.filter((q) => q.n >= PAIR_MIN).sort((x, y) => y.rate - x.rate)[0]; return `${p.name} ${pct(p.rate)}`; })()} |`,
  `| reasonable board clears round 1 | ~${pct(tg.round1ClearRate)} | ${pct(r1.clear)} (simple bot: ${pct(firstTryRate(0))} first try) |`,
  `| reasonable board clears round 5 | ~${pct(tg.round5ClearRate)} (+-${pct(tg.round5Tolerance)}) | ${pct(r5.clear)} (simple bot: ${pct(firstTryRate(runStats.nRounds - 1))} first try) |`,
  '',
  '## Sim health',
  '',
  spacing.ok
    ? `- Spacing: in ${spacing.n} random 5v5 fights no two living minis ever came closer than ${MIN_SPACING} cells (closest ${spacing.closest.toFixed(2)} cells). Passes.`
    : `- Spacing FAILS: ${spacing.tooClose} of ${spacing.n} random 5v5 fights had two living minis closer than ${MIN_SPACING} cells (closest ${spacing.closest.toFixed(2)}, seed ${spacing.worst}).`,
  `- Random 5v5 fights: average ${sec(spacing.avg)}, ${spacing.timeouts} timeouts.`,
  det.ok ? `- Deterministic: ${det.count} sampled 1v1 fights and 50 random 5v5 fights replayed twice gave identical results.` : `- NOT deterministic (seed ${det.seed}).`,
  '',
].join('\n');

writeFileSync(OUT, md);
console.log(md);
console.log(`\nWrote ${OUT}`);
process.exit(det.ok && spacing.ok ? 0 : 1);
