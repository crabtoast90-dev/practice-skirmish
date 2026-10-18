// Paint-over look experiment (?look=painted). Three steps, run in order:
//   node scripts/paintover.mjs --plates            render the empty board from the play camera
//                                                   (lit and clay), laptop 16:9 and phone 9:16
//   node scripts/paintover.mjs --paint=laptop:gpt-image-2,laptop:gpt-image-2,laptop:nano-banana-pro
//                                                   paint over the clay plate through Meshy
//   node scripts/paintover.mjs --use=laptop:<file>  copy a painting (and its camera) into public/look/
// Everything lands in look-experiment/. The Meshy key is added by the proxy, never read here.
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'look-experiment';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}`))?.split('=')[1] ?? (process.argv.includes(`--${k}`) ? '' : null);
mkdirSync(OUT, { recursive: true });

// Each device: the game's own viewport (to frame the camera exactly as play does),
// and the 16:9 / 9:16 page the plate is rendered in.
const DEVICES = {
  laptop: { aspect: '16:9', game: { viewport: { width: 1280, height: 720 } }, plate: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 } },
  phone: { aspect: '9:16', game: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, plate: { viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
};

async function plates() {
  await build({ logLevel: 'warn' });
  const server = await preview({ preview: { port: 4318, strictPort: false }, logLevel: 'warn' });
  const base = server.resolvedUrls.local[0];
  const browser = await chromium.launch({
    executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const open = async (opts) => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(e.message));
    await page.goto(`${base}?test`);
    await page.waitForFunction(() => window.__game?.state().screen === 'setup' && window.__game.state().propsLoaded, null, { timeout: 60000 });
    return page;
  };
  for (const [name, d] of Object.entries(DEVICES)) {
    const [w, h] = d.aspect.split(':').map(Number);
    const game = await open(d.game);
    const cam = await game.evaluate((a) => window.__game.plateCamera(a), w / h);
    await game.context().close();
    writeFileSync(join(OUT, `plate-${name}.json`), JSON.stringify(cam, null, 2) + '\n');
    const page = await open(d.plate);
    await page.evaluate((c) => window.__game.plate(c), cam);
    await page.screenshot({ path: join(OUT, `plate-${name}.png`) });
    await page.evaluate((c) => window.__game.plate(c, { clay: true }), cam);
    await page.screenshot({ path: join(OUT, `clay-${name}.png`) });
    await page.context().close();
    console.log(`${name}: plate-${name}.png, clay-${name}.png (${d.aspect})`);
  }
  await browser.close();
  await server.close();
}

const STYLE = 'a hand-painted storybook tabletop illustration: warm lamplight pooling from the lamp, visible brush texture, rich wood, soft vignette';
const PROMPT = [
  `Paint over image 1 as ${STYLE}.`,
  'Keep the composition exactly as in image 1: do not move, add, remove, rotate, rescale or crop anything, and keep the same camera.',
  'Every edge stays exactly in place: the board outline, the raised frame, and every inlay grid line between the 5 by 6 cells, and the centre line between the two halves.',
  'No characters, no game pieces, no figures, no text.',
  'Use image 2 only for colours and materials: honey-oak cells on the near half, darker cherry-wood cells on the far half, pale maple inlay lines between the cells,',
  'a dark wooden frame with small brass corner caps, a brass desk lamp with a green shade on the left, an ale mug on the right, a dark wooden table fading into a dim blue room.',
].join(' ');

const API = 'https://api.meshy.ai/openapi/v1';
const dataUri = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
async function meshy(path, body) {
  const res = await fetch(`${API}${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function paint(list) {
  const before = (await meshy('/balance')).balance;
  console.log(`Meshy balance before: ${before}`);
  const jobs = await Promise.all(list.split(',').map(async (item, i) => {
    const [name, model] = item.split(':');
    const { result: id } = await meshy('/image-to-image', {
      ai_model: model,
      prompt: PROMPT,
      reference_image_urls: [dataUri(join(OUT, `clay-${name}.png`)), dataUri(join(OUT, `plate-${name}.png`))],
      aspect_ratio: DEVICES[name].aspect,
    });
    return { name, model, id, n: i };
  }));
  const t0 = Date.now();
  for (const job of jobs) {
    let task;
    for (;;) {
      task = await meshy(`/image-to-image/${job.id}`);
      if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(task.status)) break;
      await new Promise((r) => setTimeout(r, 4000));
    }
    if (task.status !== 'SUCCEEDED') { console.log(`${job.model}: ${task.status} ${JSON.stringify(task.task_error)}`); continue; }
    const taken = readdirSync(OUT).filter((f) => f.startsWith(`painted-${job.name}-${job.model}-`)).length;
    const file = join(OUT, `painted-${job.name}-${job.model}-${taken + 1}.png`);
    writeFileSync(file, Buffer.from(await (await fetch(task.image_urls[0])).arrayBuffer()));
    console.log(`${file}: ${task.consumed_credits} credits, done after ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  const after = (await meshy('/balance')).balance;
  console.log(`Meshy balance after: ${after} (used ${before - after})`);
  writeFileSync(join(OUT, 'prompt.txt'), PROMPT + '\n');
}

function use(spec) {
  const [name, file] = spec.split(':');
  mkdirSync('public/look', { recursive: true });
  copyFileSync(join(OUT, file), `public/look/painted-${name}.png`);
  copyFileSync(join(OUT, `plate-${name}.json`), `public/look/painted-${name}.json`);
  console.log(`public/look/painted-${name}.png <- ${file}`);
}

if (arg('plates') !== null) await plates();
if (arg('paint')) await paint(arg('paint'));
if (arg('use')) use(arg('use'));
