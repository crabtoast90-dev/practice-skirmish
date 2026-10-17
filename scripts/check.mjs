// npm run check: build, open the game headless, play a scripted run on the
// test clock, save screenshots, and fail on console errors or a frozen state.
// Also replays the same fight in Node and fails if the browser's sim disagrees.
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { simulate } from '../src/sim/battle.js';
import { TUNING } from '../src/tuning.js';

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
for (const old of readdirSync(RUNS).sort().slice(0, -KEEP)) rmSync(join(RUNS, old), { recursive: true, force: true });

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

async function run(name, contextOptions, script) {
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

// Browser vs Node: the fight the browser played must match the same fight simulated here.
function matchNode(name, end) {
  const node = simulate(TUNING, end.boards.player, end.boards.enemy, end.seed, { record: false });
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

// One full fight: board, mid-fight, result; then "Again" goes back to the board.
async function fightRun(page, name, click) {
  await advance(page, 300);
  await shot(page, name, '1-board');
  const setup = await state(page);
  if (setup.minis !== 2) failures.push(`[${name}] expected 2 minis on the board, got ${setup.minis}`);
  await click('#fight');
  await advance(page, 100);
  const early = await state(page);
  if (early.screen !== 'battle') failures.push(`[${name}] Fight did not start a battle (screen ${early.screen})`);
  await advance(page, 6000);
  await shot(page, name, '2-mid-fight');
  const mid = await state(page);
  if (!mid.battle || mid.battle.units.every((u) => u.animation === 'idle')) failures.push(`[${name}] nobody is walking or fighting mid-battle`);
  if (mid.battle && JSON.stringify(mid.battle.units.map((u) => u.hp)) === JSON.stringify(early.battle.units.map((u) => u.hp))) failures.push(`[${name}] no damage after 6 s`);
  await finish(page);
  await shot(page, name, '3-result');
  const end = await state(page);
  summaries.push(`## ${name}\n${await page.evaluate(() => window.__game.stateText())}`);
  if (end.screen !== 'result') failures.push(`[${name}] battle never ended (screen ${end.screen})`);
  if (!(await page.isVisible('#banner'))) failures.push(`[${name}] result banner not visible`);
  matchNode(name, end);
  await click('#fight');
  await advance(page, 300);
  const again = await state(page);
  if (again.screen !== 'setup' || again.minis !== 2 || again.seed !== end.seed + 1) failures.push(`[${name}] Again did not reset the board (${again.screen}, ${again.minis} minis, seed ${again.seed})`);
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
  for (let i = 0; i < 40; i++) {
    const s = await advance(page, 100);
    closest = Math.min(closest, closestPair(s.battle.units));
  }
  await shot(page, name, '4-3v3-mid-fight');
  const mid = await state(page);
  const knights = mid.battle.units.filter((u) => u.side === 'player' && u.hp > 0);
  const columns = new Set(knights.map((u) => Math.round(u.x)));
  if (columns.size < 3) failures.push(`[${name}] 3v3: Knights did not spread out (columns ${[...columns].join(', ')})`);
  await finish(page);
  const end = await state(page);
  if (closest < 0.6) failures.push(`[${name}] 3v3: two minis came within ${closest.toFixed(2)} cells in the first 4 s`);
  summaries.push(`[${name}] 3v3 at 4 s: Knights in ${columns.size} different columns; closest two minis ${closest.toFixed(2)} cells apart`);
  summaries.push(`## ${name} 3v3\n${await page.evaluate(() => window.__game.stateText())}`);
  if (end.screen !== 'result') failures.push(`[${name}] 3v3 battle never ended (screen ${end.screen})`);
  matchNode(`${name} 3v3`, end);
}

await run('laptop', { viewport: { width: 1280, height: 720 } }, async (page, name) => {
  const click = (sel) => page.click(sel);
  await fightRun(page, name, click);
  await spreadRun(page, name, click);
});
await run('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, async (page, name) => {
  const click = (sel) => page.tap(sel);
  await fightRun(page, name, click);
  await spreadRun(page, name, click);
});

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
