// npm run sim: run thousands of battles headlessly and write BALANCE.md.
// Tonight's scope: one matchup (Knight vs Skeleton Warrior) across every
// placement pair and many seeds. Per-unit, per-pair and per-round sections
// arrive with the PLAN items that build the full roster, boards and shop.
import { writeFileSync } from 'node:fs';
import { TUNING } from '../src/tuning.js';
import { simulate, COLS, ROWS_PER_SIDE } from '../src/sim/battle.js';

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

const matchups = [
  summarise('1-star vs 1-star', duel('knight', 'skeletonWarrior'), 'Knight', 'Skeleton Warrior'),
  summarise('2-star Knight vs 1-star', duel('knight', 'skeletonWarrior', 2, 1), 'Knight (2-star)', 'Skeleton Warrior'),
];
const det = determinismCheck();
const total = matchups.reduce((s, m) => s + m.n, 0);
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
if (!det.ok) flags.push(`DETERMINISM BROKEN: seed ${det.seed} gave two different results. Nothing else in this file can be trusted until that's fixed.`);

const headline = (() => {
  const b = matchups[0];
  const who = b.winRate >= 0.5 ? 'Knight' : 'Skeleton Warrior';
  const rate = b.winRate >= 0.5 ? b.winRate : b.lossRate;
  return `One Knight vs one Skeleton Warrior: the **${who} wins ${pct(rate)}** of ${b.n} fights; fights average **${sec(b.avg)}** (most between ${sec(b.p10)} and ${sec(b.p90)}).`;
})();

const row = (m) =>
  `| ${m.label} | ${m.n} | ${pct(m.winRate)} | ${pct(m.lossRate)} | ${pct(m.drawRate)} | ${sec(m.avg)} | ${sec(m.p10)}-${sec(m.p90)} | ${pct(m.winnerHpLeft)} |`;

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
  '- Win rate per unit in mixed boards, per 2-unit pair, and per round: these need the other units\' specials and a set of "reasonable player boards" (PLAN.md, items S1-S3).',
  `- Specials not built in the sim yet: ${Object.values({ ...TUNING.units, ...TUNING.enemies }).filter((u) => !u.special.built).map((u) => `${u.name} (${u.special.name})`).join(', ')}.`,
  '',
  '## Sim health',
  '',
  det.ok ? `- Deterministic: ${det.count} sampled fights replayed twice gave identical results.` : `- NOT deterministic (seed ${det.seed}).`,
  '',
].join('\n');

writeFileSync(OUT, md);
console.log(md);
console.log(`\nWrote ${OUT}`);
process.exit(det.ok ? 0 : 1);
