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
  for (let i = 0; i < 60 && (await state(page)).screen === 'battle'; i++) await advance(page, 1000);
  await page.waitForTimeout(100);
  await shot(page, name, '3-result');
  const end = await state(page);
  summaries.push(`## ${name}\n${await page.evaluate(() => window.__game.stateText())}`);
  if (end.screen !== 'result') failures.push(`[${name}] battle never ended (screen ${end.screen})`);
  if (!(await page.isVisible('#banner'))) failures.push(`[${name}] result banner not visible`);
  // The browser's fight must match the same fight simulated here in Node.
  const node = simulate(TUNING, [{ unit: 'knight', row: 0, col: 2 }], [{ unit: 'skeletonWarrior', row: 0, col: 2 }], end.seed, { record: false });
  if (!end.result || end.result.winner !== node.winner || end.result.duration !== node.duration) {
    failures.push(`[${name}] browser fight (${end.result?.winner} in ${end.result?.duration}s) differs from Node sim (${node.winner} in ${node.duration}s)`);
  } else {
    summaries.push(`[${name}] browser fight matches Node sim: ${node.winner} in ${node.duration}s`);
  }
  await click('#fight');
  await advance(page, 300);
  const again = await state(page);
  if (again.screen !== 'setup' || again.minis !== 2 || again.seed !== end.seed + 1) failures.push(`[${name}] Again did not reset the board (${again.screen}, ${again.minis} minis, seed ${again.seed})`);
}

await run('laptop', { viewport: { width: 1280, height: 720 } }, (page, name) => fightRun(page, name, (sel) => page.click(sel)));
await run('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, (page, name) => fightRun(page, name, (sel) => page.tap(sel)));

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
