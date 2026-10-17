// npm run sim: run thousands of battles headlessly and write BALANCE.md.
// Tonight's scope: one matchup (Knight vs Skeleton Warrior) across every
// placement pair and many seeds. Per-unit, per-pair and per-round sections
// arrive with the PLAN items that build the full roster, boards and shop.
import { writeFileSync } from 'node:fs';
import { TUNING } from '../src/tuning.js';
import { simulate, makeRng, COLS, ROWS_PER_SIDE } from '../src/sim/battle.js';
import { rollOffers } from '../src/game/shop.js';

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
const total = matchups.reduce((s, m) => s + m.n, 0) + spacing.n;
const tg = TUNING.targets;

// Flags in plain words.
const flags = [];
for (const m of matchups) {
  if (m.avg < tg.fightSeconds[0]) flags.push(`${m.playerName} vs ${m.enemyName}: fights are too short (average ${sec(m.avg)}, target ${tg.fightSeconds[0]}-${tg.fightSeconds[1]} s).`);
  if (m.avg > tg.fightSeconds[1]) flags.push(`${m.playerName} vs ${m.enemyName}: fights drag (average ${sec(m.avg)}, target ${tg.fightSeconds[0]}-${tg.fightSeconds[1]} s).`);
  if (m.drawRate > 0) flags.push(`${m.playerName} vs ${m.enemyName}: ${pct(m.drawRate)} of fights time out at ${TUNING.combat.timeoutSeconds} s with both alive.`);
  if (m.winRate === 1 && !m.label.startsWith('2-star')) flags.push(`${m.playerName} never loses to a ${m.enemyName} — the duel has no counterplay.`);
  if (m.winRate === 0) flags.push(`${m.playerName} never beats a ${m.enemyName}.`);
}
const base = matchups[0];
if (base.winRate > tg.unitWinRate[1] || base.winRate < tg.unitWinRate[0]) {
  flags.push(`In the straight 1-star duel the Knight wins ${pct(base.winRate)} — outside the ${pct(tg.unitWinRate[0])}-${pct(tg.unitWinRate[1])} band. This is one duel, not a mixed-board win rate, so treat it as a hint, not a verdict.`);
}
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
  const b = matchups[0];
  const who = b.winRate >= 0.5 ? 'Knight' : 'Skeleton Warrior';
  const rate = b.winRate >= 0.5 ? b.winRate : b.lossRate;
  return `One Knight vs one Skeleton Warrior: the **${who} wins ${pct(rate)}** of ${b.n} fights; fights average **${sec(b.avg)}** (most between ${sec(b.p10)} and ${sec(b.p90)}).`;
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
  `Generated by \`npm run sim\` on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from the numbers in \`src/tuning.js\`. ${total} fights in ${((Date.now() - started) / 1000).toFixed(1)} s. Don't edit by hand; rerun the sim.`,
  '',
  '## Headline',
  '',
  headline,
  '',
  '## Flags',
  '',
  ...(flags.length ? flags.map((f) => `- ${f}`) : ['- Nothing out of line.']),
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
  `| fight length | ${tg.fightSeconds[0]}-${tg.fightSeconds[1]} s | ${sec(base.avg)} average (1-star duel) |`,
  `| unit win rate in mixed boards | ${pct(tg.unitWinRate[0])}-${pct(tg.unitWinRate[1])} | not measured yet (needs the full roster) |`,
  `| reasonable board clears round 1 | ~${pct(tg.round1ClearRate)} | not measured yet (needs player boards and rounds) |`,
  `| reasonable board clears round 5 | ~${pct(tg.round5ClearRate)} | not measured yet |`,
  '',
  '## Not measured yet',
  '',
  '- Win rate per unit in mixed boards, per 2-unit pair, and per round: these need a set of "reasonable player boards" (PLAN.md, item A3).',
  `- Specials not built in the sim yet: ${Object.values(allUnits).filter((u) => !u.special.built && u.special.kind !== 'none').map((u) => `${u.name} (${u.special.name})`).join(', ') || 'none'}.`,
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
