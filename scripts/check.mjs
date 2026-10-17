// npm run check: build, open the game headless, play a scripted run on the
// test clock, save screenshots, and fail on console errors or a frozen state.
// Also replays the same fight in Node and fails if the browser's sim disagrees.
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { simulate } from '../src/sim/battle.js';
import { TUNING } from '../src/tuning.js';
import { createShop } from '../src/game/shop.js';
import { createRun } from '../src/game/run.js';
import { botShop } from '../src/game/bot.js';

const RUNS = 'check-output';
const KEEP = 5;
const OUT = join(RUNS, new Date().toISOString().replace(/[:.]/g, '-')); // one folder per run
const URL_ARG = process.argv.find((a) => a.startsWith('--url='))?.slice(6); // check a deployed build instead

// Browser: CHROME_PATH, else the cloud's preinstalled Chromium, else Playwright's own.
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium';
  return undefined;
}

const failures = [];
const log = [];

mkdirSync(OUT, { recursive: true });
// Keep the newest KEEP runs (timestamped names sort oldest-first); delete the rest.
// Only timestamped run folders rotate; the look sheet files at the top level stay.
for (const old of readdirSync(RUNS).filter((f) => /^\d{4}-/.test(f)).sort().slice(0, -KEEP)) rmSync(join(RUNS, old), { recursive: true, force: true });

let server;
let base = URL_ARG;
if (!base) {
  await build({ logLevel: 'warn' });
  server = await preview({ preview: { port: 4317, strictPort: false }, logLevel: 'warn' });
  base = server.resolvedUrls.local[0];
}

const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

// Pick the first seed whose round-1 shop offers two Knights and a third 2-gold
// unit, and whose round-2 roll offers another unit we can afford.
function shopSeed() {
  for (let seed = 1; seed < 5000; seed++) {
    const shop = createShop(TUNING, seed);
    const o = shop.state.offers;
    const third = o.findIndex((u) => u !== 'knight');
    if (o.filter((u) => u === 'knight').length !== 2 || third < 0 || TUNING.units[o[third]].cost !== 2) continue;
    shop.state.gold -= 6;
    shop.startRound(2);
    const left = shop.state.gold;
    if (shop.state.offers.some((u) => u !== 'knight' && u !== o[third] && TUNING.units[u].cost <= left)) return seed;
  }
  throw new Error('no seed gives a shop with two Knights');
}
const SEED = shopSeed();
const summariesGold = {}; // gold left after the first shop, per run

async function run(name, contextOptions, script, seed = SEED) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('console', (msg) => {
    const line = `[${name}] console.${msg.type()}: ${msg.text()}`;
    log.push(line);
    if (msg.type() === 'error') failures.push(line);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      const line = `[${name}] HTTP ${res.status()} ${res.url()}`;
      log.push(line);
      failures.push(line);
    }
  });
  page.on('pageerror', (err) => {
    const line = `[${name}] page error: ${err.message}`;
    log.push(line);
    failures.push(line);
  });
  const url = new URL(base);
  url.searchParams.set('test', '');
  url.searchParams.set('seed', seed);
  await page.goto(url.href.replace('test=', 'test'));
  await page.waitForFunction(() => window.__game);
  await page.waitForFunction(() => window.__game.state().screen === 'setup' && window.__game.state().propsLoaded, null, { timeout: 60000 });
  await script(page, name);
  await context.close();
}

const shot = (page, name, step) => page.screenshot({ path: join(OUT, `${name}-${step}.png`) });
const state = (page) => page.evaluate(() => window.__game.state());
const advance = (page, ms) => page.evaluate((t) => window.__game.advance(t), ms);
const summaries = [];
const lookFiles = {};

// The look sheet: the 3v3 mid-fight from three camera angles (laptop), and the phone's
// play view. The test clock is frozen, so all three show the same moment.
async function lookShots(page, name) {
  if (name === 'phone') {
    await shot(page, name, 'look');
    lookFiles.phone = join(OUT, `${name}-look.png`);
    return;
  }
  for (const v of ['game', 'low', 'lamp']) {
    await page.evaluate((x) => window.__game.setView(x), v);
    await shot(page, name, `look-${v}`);
    lookFiles[v] = join(OUT, `${name}-look-${v}.png`);
  }
  await page.evaluate(() => window.__game.setView('game'));
}

// Lay the three laptop angles side by side with captions, in a blank page.
async function composeLookSheet() {
  const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  const tile = (k, label) => `<figure><img src="${img(lookFiles[k])}"><figcaption>${label}</figcaption></figure>`;
  const context = await browser.newContext({ viewport: { width: 1920, height: 400 } });
  const page = await context.newPage();
  await page.setContent(`<style>body{margin:0;background:#0b0d13;display:flex;gap:8px;padding:8px;font:14px Georgia,serif;color:#ffe2b0}
    figure{margin:0;flex:1}img{width:100%;display:block;border-radius:4px}figcaption{padding:4px 2px}</style>
    ${tile('game', 'Play view (laptop)')}${tile('low', 'Low, front-right')}${tile('lamp', 'From the right, towards the lamp')}`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const sheet = join(RUNS, 'look-compare.png');
  await page.screenshot({ path: sheet, fullPage: true });
  copyFileSync(sheet, join(OUT, 'look-compare.png'));
  copyFileSync(lookFiles.phone, join(RUNS, 'look-phone.png'));
  await context.close();
  summaries.push(`look sheet: ${sheet} (laptop, 3 angles) and ${join(RUNS, 'look-phone.png')} (phone)`);
}

// Browser vs Node: the fight the browser played must match the same fight simulated here.
function matchNode(name, end) {
  const node = simulate(TUNING, end.boards.player, end.boards.enemy, end.fightSeed, { record: false });
  if (!end.result || end.result.winner !== node.winner || end.result.duration !== node.duration) {
    failures.push(`[${name}] browser fight (${end.result?.winner} in ${end.result?.duration}s) differs from Node sim (${node.winner} in ${node.duration}s)`);
  } else {
    summaries.push(`[${name}] browser fight matches Node sim: ${node.winner} in ${node.duration}s`);
  }
}

// Closest two living minis, in cells.
function closestPair(units) {
  const alive = units.filter((u) => u.hp > 0);
  let best = Infinity;
  for (let a = 0; a < alive.length; a++) for (let b = a + 1; b < alive.length; b++) best = Math.min(best, Math.hypot(alive[a].x - alive[b].x, alive[a].y - alive[b].y));
  return best;
}

async function finish(page) {
  for (let i = 0; i < 60 && (await state(page)).screen === 'battle'; i++) await advance(page, 1000);
  await page.waitForTimeout(100);
}

// Shop: buy a Knight and place it, buy a second unit and place it, buy the
// second Knight (it merges into a 2-star on the board), then move a unit.
async function shopRun(page, name, click, tapAt) {
  const tapCell = async (row, col) => {
    const p = await page.evaluate(([r, c]) => window.__game.cellToScreen(r, c), [row, col]);
    await tapAt(p.x, p.y);
    await advance(page, 50);
  };
  const expect = (cond, msg) => { if (!cond) failures.push(`[${name}] ${msg}`); };
  if (VICTORY_ENEMY) await page.evaluate((e) => window.__game.setEnemy(e), VICTORY_ENEMY);
  await advance(page, 300);
  let s = await state(page);
  await shot(page, name, '0-shop');
  expect(await page.isVisible('#shop'), 'shop panel not visible');
  expect(s.offers.length === TUNING.economy.offersPerRound, `expected ${TUNING.economy.offersPerRound} offers, got ${s.offers.length}`);
  expect(s.gold === TUNING.economy.startingGold + TUNING.economy.incomePerRound[0], `round 1 gold is ${s.gold}`);
  expect(s.board.length === 0 && !s.held, 'board should start empty');
  expect(await page.isDisabled('#fight'), 'Fight should be disabled with nothing bought');
  const knights = s.offers.map((u, i) => (u === 'knight' ? i : -1)).filter((i) => i >= 0);
  const other = s.offers.findIndex((u) => u !== 'knight');
  const otherUnit = s.offers[other];
  const gold0 = s.gold;

  await click(`.offer[data-slot="${knights[0]}"]`);
  await advance(page, 50);
  s = await state(page);
  expect(s.held?.unit === 'knight' && s.gold === gold0 - 2, `buying a Knight: hand ${s.held?.unit}, gold ${s.gold}`);
  expect((await page.textContent(`.offer[data-slot="${knights[0]}"]`)).includes('Sold'), 'bought slot not marked sold');
  await shot(page, name, '1-holding');
  await tapCell(0, 2);
  s = await state(page);
  expect(s.round === 1 && s.lives === TUNING.economy.lives && s.enemy.length === (VICTORY_ENEMY ?? TUNING.rounds[0].board).length, `run should start at round 1 with ${TUNING.economy.lives} lives against round 1's board (round ${s.round}, ${s.lives} lives)`);
  expect((await page.textContent('#round')).includes('Round 1') && (await page.$$('#lives .pip:not(.lost)')).length === TUNING.economy.lives, 'round counter or lives pips missing');
  expect(s.board.some((u) => u.unit === 'knight' && u.row === 0 && u.col === 2) && !s.held && s.minis === 1 + s.enemy.length, `Knight not placed at front centre (${JSON.stringify(s.board)})`);

  await click(`.offer[data-slot="${other}"]`);
  await advance(page, 50);
  await tapCell(2, 1);
  s = await state(page);
  expect(s.board.some((u) => u.unit === otherUnit && u.row === 2 && u.col === 1), `${otherUnit} not placed at back left`);

  expect((await page.textContent(`.offer[data-slot="${knights[1]}"]`)).includes('★★'), 'second Knight offer does not say it makes a 2-star');
  await click(`.offer[data-slot="${knights[1]}"]`);
  await advance(page, 50);
  s = await state(page);
  const k = s.board.filter((u) => u.unit === 'knight');
  expect(k.length === 1 && k[0].star === 2 && !s.held && s.lastMerge?.unit === 'knight', `second Knight did not merge into a 2-star (${JSON.stringify(s.board)}, hand ${JSON.stringify(s.held)})`);
  expect(s.minis === 2 + s.enemy.length, `expected ${2 + s.enemy.length} minis after the merge, got ${s.minis}`);
  await shot(page, name, '2-merged');

  // Pick the back unit up and move it to the middle row.
  await tapCell(2, 1);
  s = await state(page);
  expect(s.held?.unit === otherUnit && s.board.length === 1, `tapping the ${otherUnit} did not pick it up`);
  await tapCell(1, 3);
  s = await state(page);
  expect(s.board.some((u) => u.unit === otherUnit && u.row === 1 && u.col === 3) && !s.held, `${otherUnit} not moved to the middle row`);
  expect(s.gold === gold0 - 6, `gold after three buys is ${s.gold}, expected ${gold0 - 6}`);
  summariesGold[name] = s.gold;
  summaries.push(`## ${name} shop\n${await page.evaluate(() => window.__game.stateText())}`);
}

// Round 2's shop: buy one more unit and place it, so three units stand on your half.
async function thirdUnit(page, name, click, tapAt) {
  let s = await state(page);
  const income = TUNING.economy.incomePerRound[1];
  if (s.round !== 2 || s.gold !== summariesGold[name] + income) failures.push(`[${name}] after Next round: round ${s.round}, gold ${s.gold} (expected round 2 and ${summariesGold[name]} + ${income} income)`);
  else summaries.push(`[${name}] after Next round: round 2, ${summariesGold[name]} gold left + ${income} income = ${s.gold} gold`);
  const slot = s.offers.findIndex((u) => u && u !== 'knight' && !s.board.some((b) => b.unit === u) && TUNING.units[u].cost <= s.gold);
  if (slot < 0) { failures.push(`[${name}] no affordable new unit in round 2 (${s.offers}, ${s.gold} gold)`); return; }
  await click(`.offer[data-slot="${slot}"]`);
  await advance(page, 50);
  const p = await page.evaluate(() => window.__game.cellToScreen(0, 0));
  await tapAt(p.x, p.y);
  await advance(page, 300);
  s = await state(page);
  if (s.board.length !== 3 || s.minis !== 3 + s.enemy.length) failures.push(`[${name}] expected three units placed (${3 + s.enemy.length} minis), got ${s.board.length} units, ${s.minis} minis`);
  await shot(page, name, '5-three-units');
  summaries.push(`## ${name} round 2 shop\n${await page.evaluate(() => window.__game.stateText())}`);
}

// One full fight: board, mid-fight, result; then "Again" goes back to the board.
async function fightRun(page, name, click) {
  await advance(page, 300);
  const setup = await state(page);
  const expectMinis = setup.board.length + (VICTORY_ENEMY ?? TUNING.rounds[1].board).length;
  // Framing: the whole board frame (and far minis' heads) must be on screen.
  const f = setup.frame;
  if (f.x0 < -1 || f.x1 > 1 || f.y0 < -1 || f.y1 > 1) failures.push(`[${name}] board clips the screen edge (x ${f.x0.toFixed(2)}..${f.x1.toFixed(2)}, y ${f.y0.toFixed(2)}..${f.y1.toFixed(2)})`);
  await click('#fight');
  await advance(page, 100);
  const early = await state(page);
  if (early.screen !== 'battle') failures.push(`[${name}] Fight did not start a battle (screen ${early.screen})`);
  await advance(page, 6000);
  await shot(page, name, '3-mid-fight');
  const mid = await state(page);
  if (!mid.battle || mid.battle.units.every((u) => u.animation === 'idle')) failures.push(`[${name}] nobody is walking or fighting mid-battle`);
  if (mid.battle && JSON.stringify(mid.battle.units.map((u) => u.hp)) === JSON.stringify(early.battle.units.map((u) => u.hp))) failures.push(`[${name}] no damage after 6 s`);
  await finish(page);
  await shot(page, name, '4-result');
  const end = await state(page);
  summaries.push(`## ${name}\n${await page.evaluate(() => window.__game.stateText())}`);
  if (end.screen !== 'result') failures.push(`[${name}] battle never ended (screen ${end.screen})`);
  if (!(await page.isVisible('#banner'))) failures.push(`[${name}] result banner not visible`);
  matchNode(name, end);
  if (end.result?.winner !== 'player' || (await page.textContent('#fight')) !== 'Next round') failures.push(`[${name}] round 1 should be won with "Next round" (${end.result?.winner}, button "${await page.textContent('#fight')}")`);
  await click('#fight');
  await advance(page, 300);
  const next = await state(page);
  const gold = end.gold + TUNING.economy.incomePerRound[1];
  if (next.screen !== 'setup' || next.round !== 2 || next.gold !== gold || next.minis !== expectMinis) failures.push(`[${name}] Next round did not open round 2's shop (${next.screen}, round ${next.round}, ${next.gold} gold vs ${gold}, ${next.minis} minis vs ${expectMinis})`);
  if (!(await page.isVisible('#shop'))) failures.push(`[${name}] shop not back for round 2`);
}

// 3v3 where the Knights start queued in one column: they should fan out across
// the enemy front instead of lining up behind each other, and never overlap.
const SPREAD_PLAYER = [{ unit: 'knight', row: 0, col: 2 }, { unit: 'knight', row: 1, col: 2 }, { unit: 'knight', row: 2, col: 2 }];
const SPREAD_ENEMY = [{ unit: 'skeletonWarrior', row: 1, col: 2 }, { unit: 'skeletonWarrior', row: 2, col: 1 }, { unit: 'skeletonWarrior', row: 2, col: 3 }];
async function spreadRun(page, name, click) {
  await page.evaluate(([p, e]) => window.__game.setBoards(p, e), [SPREAD_PLAYER, SPREAD_ENEMY]);
  await advance(page, 300);
  const setup = await state(page);
  if (setup.minis !== 6) failures.push(`[${name}] 3v3: expected 6 minis on the board, got ${setup.minis}`);
  await click('#fight');
  let closest = Infinity;
  let columns = new Set();
  for (let i = 0; i < 40; i++) {
    const s = await advance(page, 100);
    closest = Math.min(closest, closestPair(s.battle.units));
    // Widest the living Knights have fanned out so far (strong skeletons may kill some before 4 s).
    const cols = new Set(s.battle.units.filter((u) => u.side === 'player' && u.hp > 0).map((u) => Math.round(u.x)));
    if (cols.size > columns.size) columns = cols;
  }
  await shot(page, name, '6-3v3-mid-fight');
  await lookShots(page, name);
  if (columns.size < 3) failures.push(`[${name}] 3v3: Knights did not spread out (columns ${[...columns].join(', ')})`);
  await finish(page);
  const end = await state(page);
  if (closest < 0.6) failures.push(`[${name}] 3v3: two minis came within ${closest.toFixed(2)} cells in the first 4 s`);
  summaries.push(`[${name}] 3v3 in the first 4 s: Knights fanned out across ${columns.size} columns; closest two minis ${closest.toFixed(2)} cells apart`);
  summaries.push(`## ${name} 3v3\n${await page.evaluate(() => window.__game.stateText())}`);
  if (end.screen !== 'result') failures.push(`[${name}] 3v3 battle never ended (screen ${end.screen})`);
  matchNode(`${name} 3v3`, end);
}

// Specials: a 5v5 where every special goes off. Steps the clock in tenths of a second and
// screenshots the first moment each effect is on screen, so every shot is mid-effect.
// Candidate boards (2-star heroes, so the Knight lives to raise Shield Wall); the check
// plays the first one where, simulated in Node with the coming fight's seed, all six specials fire.
const S2 = (unit, row, col) => ({ unit, row, col, star: 2 });
const E1 = (unit, row, col) => ({ unit, row, col });
const FX_PLAYERS = [
  [S2('knight', 2, 4), S2('barbarian', 0, 1), S2('rogue', 1, 2), S2('mage', 2, 1), S2('ranger', 2, 2)],
  [S2('knight', 0, 1), S2('barbarian', 0, 3), S2('rogue', 1, 2), S2('mage', 2, 1), S2('ranger', 2, 3)],
  [S2('knight', 0, 2), S2('barbarian', 0, 3), S2('rogue', 1, 1), S2('mage', 2, 1), S2('ranger', 2, 3)],
  [S2('knight', 1, 2), S2('barbarian', 0, 2), S2('rogue', 1, 1), S2('mage', 2, 1), S2('ranger', 2, 3)],
  [S2('knight', 2, 0), S2('barbarian', 0, 2), S2('rogue', 1, 1), S2('mage', 2, 2), S2('ranger', 2, 4)],
];
const FX_ENEMIES = [
  [E1('skeletonMinion', 0, 1), E1('skeletonMinion', 0, 2), E1('skeletonMinion', 0, 3), E1('skeletonMage', 2, 1), E1('skeletonWarrior', 1, 3)],
  [E1('skeletonMinion', 0, 1), E1('skeletonMinion', 0, 3), E1('skeletonMinion', 1, 2), E1('skeletonMage', 2, 1), E1('skeletonMage', 2, 3)],
  [E1('skeletonWarrior', 0, 2), E1('skeletonMinion', 0, 1), E1('skeletonMinion', 0, 3), E1('skeletonMage', 2, 1), E1('skeletonMage', 2, 3)],
  [E1('skeletonMinion', 0, 1), E1('skeletonMinion', 0, 3), E1('skeletonMage', 2, 2), E1('skeletonWarrior', 0, 2)],
  [E1('skeletonMinion', 0, 0), E1('skeletonMinion', 0, 1), E1('skeletonMinion', 0, 2), E1('skeletonMinion', 0, 3), E1('skeletonMinion', 0, 4), E1('skeletonMage', 2, 2)],
];
const FX_BOARDS = FX_ENEMIES.flatMap((e) => FX_PLAYERS.map((p) => [p, e]));
function fxBoard(seed) {
  const fires = ([p, e]) => {
    const r = simulate(TUNING, p, e, seed);
    const names = new Set(r.events.filter((ev) => ev.type === 'special').map((ev) => ev.name));
    return ['Shield Wall', 'Cleave', 'Shadow Leap', 'Fireball', 'Piercing Arrow', 'Bone Burst'].every((n) => names.has(n));
  };
  return FX_BOARDS.find(fires) ?? FX_BOARDS[0];
}
const FX_SPECIALS = { shield: 'Shield Wall', cleave: 'Cleave', leap: 'Shadow Leap', fireburst: 'Fireball', pierce: 'Piercing Arrow', boneBurst: 'Bone Burst', blow: 'Heavy Blow' };
const FX_ATTACKS = { arrow: 'arrow', bolt: 'Mage bolt', boneBolt: 'Skeleton Mage bolt', number: 'damage number', hit: 'hit flash' };
async function specialsRun(page, name, click) {
  if ((await state(page)).screen === 'result') { await click('#fight'); await advance(page, 300); } // on to the next shop first
  const [fxPlayer, fxEnemy] = fxBoard((await state(page)).fightSeed + 1); // run.js: each fight's seed is the last one's + 1
  await page.evaluate(([p, e]) => window.__game.setBoards(p, e), [fxPlayer, fxEnemy]);
  await advance(page, 300);
  await click('#fight');
  const caught = [];
  const shots = [];
  const firstSeen = {}; // effect -> step it first showed; shoot two steps (0.2 s) in, when it's in full swing
  for (let i = 0; i < 200; i++) {
    const s = await advance(page, 100);
    if (s.screen !== 'battle') break;
    const now = Object.keys(s.battle.effects);
    for (const k of now) firstSeen[k] ??= i;
    const fresh = now.filter((k) => (k in FX_SPECIALS || k in FX_ATTACKS) && !caught.includes(k) && i - firstSeen[k] >= 2);
    // One shot for normal attacks, once an arrow or bolt and a damage number are both on screen.
    const attacks = (now.includes('arrow') || now.includes('bolt')) && now.includes('number') && !caught.includes('attacks');
    const specials = fresh.filter((k) => k in FX_SPECIALS);
    if (specials.length) {
      const file = `8-special-${specials.join('-')}`;
      await shot(page, name, file);
      shots.push(`${file} at ${s.battle.t}s (${specials.map((k) => FX_SPECIALS[k]).join(' + ')}; also on screen: ${now.filter((k) => !specials.includes(k)).join(', ')})`);
      caught.push(...specials);
    }
    if (attacks) {
      await shot(page, name, '8-attacks');
      shots.push(`8-attacks at ${s.battle.t}s (${now.join(', ')})`);
      caught.push('attacks');
    }
  }
  await finish(page);
  const end = await state(page);
  const seen = end.battle?.effectsSeen ?? {};
  const missing = ['shield', 'cleave', 'leap', 'fireball', 'fireburst', 'pierce', 'bone', 'boneBurst', 'arrow', 'bolt', 'boneBolt', 'hit', 'number'].filter((k) => !seen[k]);
  if (missing.length) failures.push(`[${name}] specials fight: these effects never played: ${missing.join(', ')}`);
  const specialShots = caught.filter((k) => k in FX_SPECIALS && k !== 'blow');
  if (specialShots.length < 4) failures.push(`[${name}] specials fight: only ${specialShots.length} specials caught mid-effect (${specialShots.join(', ')}), want at least 4`);
  summaries.push(`[${name}] specials fight: ${specialShots.length} specials caught mid-effect; effects played: ${Object.entries(seen).map(([k, n]) => `${k}×${n}`).join(', ')}\n  ${shots.join('\n  ')}`);
  if (end.screen !== 'result') failures.push(`[${name}] specials fight never ended (screen ${end.screen})`);
  matchNode(`${name} specials`, end);
}

// Line-up: all nine minis standing on the board facing the camera, each with
// its own model file; then back to a normal board.
async function lineupRun(page, name) {
  const s = await page.evaluate(() => window.__game.lineup());
  const want = [...Object.keys(TUNING.units), ...Object.keys(TUNING.enemies)];
  const files = new Set(s.models.map((m) => m.model));
  if (s.screen !== 'lineup' || s.minis !== want.length) failures.push(`[${name}] line-up: expected ${want.length} minis, got ${s.minis} (screen ${s.screen})`);
  if (files.size !== want.length) failures.push(`[${name}] line-up: ${files.size} different model files for ${want.length} minis`);
  for (const u of want) if (!s.models.some((m) => m.unit === u)) failures.push(`[${name}] line-up: no ${u} on the board`);
  await advance(page, 400);
  await shot(page, name, '7-lineup');
  await page.evaluate(() => window.__game.setView('lineup'));
  await shot(page, name, '7-lineup-close');
  await page.evaluate(() => window.__game.setView('game'));
  summaries.push(`## ${name} line-up\n${await page.evaluate(() => window.__game.stateText())}`);
}

// Whole runs: the bot plays a seeded run here in Node, then the browser replays
// the same taps; every round's result must match. Screenshots each round's
// result and the end screen, then "Play again" must start a fresh run.
function botRun(seed, style, enemy) {
  const run = createRun(TUNING, seed);
  const phases = [];
  while (run.state.phase === 'shop') {
    const actions = botShop(TUNING, run.shop, { style });
    run.fight({ record: false, ...(enemy && { enemy }) });
    phases.push({ actions, after: { ...run.state.last, lives: run.state.lives, phase: run.state.phase } });
    run.next();
  }
  return { phases, end: run.state.phase };
}
function findSeed(style, end, want = () => true, enemy) {
  for (let seed = 1; seed < 2000; seed++) {
    const r = botRun(seed, style, enemy);
    if (r.end === end && want(r)) return seed;
  }
  throw new Error(`no seed where the ${style} bot reaches ${end}`);
}
// Victory: prefer a run that loses a round on the way, to show the replay.
// If the tuning makes the real skeleton boards unbeatable for the bot, the shop
// run and the Victory run fight one stand-in Minion every round instead, so round
// results, "Next round" and the Victory screen are still checked (the summary says so).
let VICTORY_SEED;
let VICTORY_ENEMY = null;
const STAND_IN_ENEMY = [{ unit: 'skeletonMinion', row: 0, col: 2 }];
try { VICTORY_SEED = findSeed('greedy', 'victory', (r) => r.phases.some((p) => !p.after.won)); } catch {
  try { VICTORY_SEED = findSeed('greedy', 'victory'); } catch {
    VICTORY_ENEMY = STAND_IN_ENEMY;
    VICTORY_SEED = findSeed('greedy', 'victory', () => true, VICTORY_ENEMY);
  }
}
const DEFEAT_SEED = findSeed('stingy', 'defeat');

async function wholeRun(page, name, click, tapAt, seed, style, enemy = null) {
  const plan = botRun(seed, style, enemy);
  const tag = `${name} ${plan.end}`;
  if (enemy) await page.evaluate((e) => window.__game.setEnemy(e), enemy);
  const expect = (cond, msg) => { if (!cond) failures.push(`[${tag}] ${msg}`); };
  let fights = 0;
  for (const phase of plan.phases) {
    let s = await state(page);
    expect(s.screen === 'setup' && s.round === phase.after.round, `expected round ${phase.after.round}'s shop, got ${s.screen} round ${s.round}`);
    for (const a of phase.actions) {
      if (a.type === 'buy') await click(`.offer[data-slot="${a.slot}"]`);
      if (a.type === 'reroll') await click('#reroll');
      if (a.type === 'tap') {
        const p = await page.evaluate(([r, c]) => window.__game.cellToScreen(r, c), [a.row, a.col]);
        await tapAt(p.x, p.y);
      }
      await advance(page, 20);
    }
    await click('#fight');
    await advance(page, 60000); // the whole fight plus the pause after it, in one go
    fights += 1;
    s = await state(page);
    const want = phase.after;
    const n = want.round;
    expect(s.result && s.result.winner === want.winner && s.result.duration === want.duration && s.lives === want.lives,
      `round ${n}: browser ${s.result?.winner} in ${s.result?.duration}s with ${s.lives} lives, Node ${want.winner} in ${want.duration}s with ${want.lives}`);
    matchNode(`${tag} r${n}`, s);
    await shot(page, `${name}-${plan.end}`, `${fights}-round${n}-${want.won ? 'won' : 'lost'}`);
    if (want.phase === 'result') {
      expect(await page.isVisible('#banner'), `round ${n} result banner not visible`);
      await click('#fight');
      await advance(page, 300);
    }
  }
  const s = await state(page);
  expect(s.screen === plan.end, `run should end on ${plan.end}, screen is ${s.screen}`);
  expect((await page.textContent('#banner')).startsWith(plan.end === 'victory' ? 'Victory' : 'Defeat'), 'end banner text wrong');
  expect((await page.textContent('#fight')) === 'Play again', 'no "Play again" button');
  summaries.push(`## ${tag} (seed ${seed}, ${style} bot)\n${await page.evaluate(() => window.__game.stateText())}`);
  await page.waitForTimeout(50);
  await shot(page, `${name}-${plan.end}`, `${fights + 1}-end-screen`);
  await click('#fight');
  await advance(page, 300);
  const again = await state(page);
  expect(again.screen === 'setup' && again.round === 1 && again.lives === TUNING.economy.lives && again.board.length === 0 && again.seed === seed + 1 && !(await page.isVisible('#banner')),
    `Play again did not start a fresh run (${again.screen}, round ${again.round}, ${again.lives} lives, ${again.board.length} units, seed ${again.seed})`);
  summaries.push(`[${tag}] ${fights} fights matched Node, rounds ${plan.phases.map((p) => `${p.after.round}${p.after.won ? 'W' : 'L'}`).join(' ')}; Play again starts round 1 with ${again.lives} lives`);
}

async function fullRun(page, name, click, tapAt) {
  await shopRun(page, name, click, tapAt);
  await fightRun(page, name, click);
  await thirdUnit(page, name, click, tapAt);
  await spreadRun(page, name, click);
  await specialsRun(page, name, click);
  await lineupRun(page, name);
}

summaries.push(`shop seed ${SEED} (first seed whose round-1 shop offers two Knights); victory run seed ${VICTORY_SEED}${VICTORY_ENEMY ? ' (no seed beats the real skeleton boards with this tuning, so it fights one stand-in Skeleton Minion each round)' : ''}; defeat run seed ${DEFEAT_SEED}`);
const DEVICES = {
  laptop: [{ viewport: { width: 1280, height: 720 } }, (page) => [(sel) => page.click(sel), (x, y) => page.mouse.click(x, y)]],
  phone: [{ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, (page) => [(sel) => page.tap(sel), (x, y) => page.touchscreen.tap(x, y)]],
};
for (const [name, [opts, input]] of Object.entries(DEVICES)) {
  await run(name, opts, (page) => fullRun(page, name, ...input(page)));
  await run(name, opts, (page) => wholeRun(page, name, ...input(page), VICTORY_SEED, 'greedy', VICTORY_ENEMY), VICTORY_SEED);
  await run(name, opts, (page) => wholeRun(page, name, ...input(page), DEFEAT_SEED, 'stingy'), DEFEAT_SEED);
}

if (lookFiles.game && lookFiles.phone) await composeLookSheet();
else failures.push('look sheet: missing shots');

await browser.close();
await server?.close();

const report = [
  `# Check ${failures.length ? 'FAILED' : 'passed'} — ${new Date().toISOString()}`,
  `target: ${base}`,
  '',
  ...summaries,
  '',
  '## failures',
  ...(failures.length ? failures : ['none']),
  '',
  '## console',
  ...(log.length ? log : ['(empty)']),
].join('\n');
writeFileSync(join(OUT, 'summary.txt'), report + '\n');
console.log(report);
console.log(`\nScreenshots and summary in ${OUT}/`);
process.exit(failures.length ? 1 : 0);
