import * as THREE from 'three';
import { createScene } from './view/scene.js';
import { createUnits } from './view/units.js';
import { createPlayback } from './view/playback.js';
import { createPost } from './view/post.js';
import { createClock, STEP } from './clock.js';
import { createDebugOverlay } from './debug.js';
import { globalRow } from './sim/battle.js';
import { TUNING } from './tuning.js';
import { createRun } from './game/run.js';
import { createShopUI } from './view/shopUI.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const phone = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const quality = { pixelRatio: 2, shadowMap: phone ? 1024 : 2048 };

// One sitting: five rounds against tuning.rounds' boards, three lives (src/game/run.js).
// ?seed=N picks the run; "Play again" starts the next seed. Local rows: 0 = front.
let seed = Number(params.get('seed') ?? 1);
let run = createRun(TUNING, seed);
let shop = run.shop;
let testEnemy = null; // set by the setBoards test hook
const enemyBoard = () => testEnemy ?? run.enemyBoard();
let fought = { player: [], enemy: [], seed: null }; // the boards and seed of the last fight

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality.pixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;

const { scene, boardSize, lampHead } = createScene(quality);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
const BLUR = phone ? 6 : 8;
const post = createPost(renderer, scene, camera, { blur: BLUR });

// Camera views. 'game' is the play view; the others are for the look sheet.
// elevation = degrees above the table, yaw = degrees round from the player's side.
const VIEWS = {
  game: { elevation: phone ? 56 : 50, yaw: 0 },
  low: { elevation: 24, yaw: 30, zoom: 0.72, focus: new THREE.Vector3(0, 0.6, 0.4) },
  lamp: { elevation: 34, yaw: 100, zoom: 0.95, focus: new THREE.Vector3(-1.2, 0.6, -0.4) },
  lineup: { elevation: 34, yaw: 0, zoom: 0.5, focus: new THREE.Vector3(0, 0.6, -0.1) }, // close on the two middle rows
};
let view = 'game';

// Everything the play view must keep on screen: the frame's corners, and the
// heads and HP bars of minis on the far row.
const FRAME_POINTS = [];
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    for (const y of [0, boardSize.h]) FRAME_POINTS.push(new THREE.Vector3(sx * boardSize.w / 2, y, sz * boardSize.d / 2));
    FRAME_POINTS.push(new THREE.Vector3(sx * (boardSize.w / 2 - 0.5), 2.0, -boardSize.d / 2 + 0.8));
  }
}

function placeCamera(target, elevation, yaw, d) {
  const e = THREE.MathUtils.degToRad(elevation);
  const y = THREE.MathUtils.degToRad(yaw);
  camera.position.set(
    target.x + d * Math.cos(e) * Math.sin(y),
    target.y + d * Math.sin(e),
    target.z + d * Math.cos(e) * Math.cos(y),
  );
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

// Screen bounds (in -1..1) of the frame points from the current camera.
function frameBounds() {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const p of FRAME_POINTS) {
    const q = p.clone().project(camera);
    b.x0 = Math.min(b.x0, q.x); b.x1 = Math.max(b.x1, q.x);
    b.y0 = Math.min(b.y0, q.y); b.y1 = Math.max(b.y1, q.y);
  }
  return b;
}

// Fit the board into the screen area between the title and the shop panel
// (`inset` px at the bottom, measured from the page):
// back the camera off until every frame point fits, then slide it so the board
// sits centred in that area. On a tall phone the lens widens a little instead
// of backing far away, so minis stay big.
function frameGame(w, h, inset) {
  const { elevation, yaw } = VIEWS.game;
  const top = phone ? 104 : 80; // title and the round / lives bar
  const bottom = Math.max(inset + 10, 40);
  const aspect = w / Math.max(1, h - top - bottom);
  camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(40) / 2) / aspect)), 30, 40);
  camera.updateProjectionMatrix();
  const px = (n) => (2 * n) / h;
  const side = 2 * 14 / w;
  const box = { x0: -1 + side, x1: 1 - side, y0: -1 + px(bottom), y1: 1 - px(top) };
  const target = new THREE.Vector3(0, 0.3, 0);
  let d = 12;
  for (let pass = 0; pass < 4; pass++) {
    let lo = 2;
    let hi = 60;
    for (let i = 0; i < 30; i++) {
      d = (lo + hi) / 2;
      placeCamera(target, elevation, yaw, d);
      const b = frameBounds();
      if (b.x1 - b.x0 > box.x1 - box.x0 || b.y1 - b.y0 > box.y1 - box.y0) lo = d; else hi = d;
    }
    d = hi;
    placeCamera(target, elevation, yaw, d);
    const b = frameBounds();
    // Slide along the table so the board's screen centre meets the box's centre.
    const dy = (b.y0 + b.y1) / 2 - (box.y0 + box.y1) / 2;
    target.z -= dy * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.sin(THREE.MathUtils.degToRad(elevation));
  }
  placeCamera(target, elevation, yaw, d);
  return { target, d };
}

// Two play framings: with the shop open (board above the panel) and during the
// fight (shop hidden, board bigger). The camera glides between them.
let frames = null;
let gameFrame = null;
const wantedFrame = () => (shopPanel.hidden ? frames.fight : frames.shop);
function glideCamera(dt) {
  const want = wantedFrame();
  if (gameFrame === want) return;
  const k = 1 - Math.exp(-dt * 5);
  const target = gameFrame.target.clone().lerp(want.target, k);
  const d = gameFrame.d + (want.d - gameFrame.d) * k;
  gameFrame = target.distanceTo(want.target) < 1e-3 && Math.abs(d - want.d) < 1e-3 ? want : { target, d };
  if (view === 'game') { applyView(); playback.refresh(); }
}
function applyView() {
  const v = VIEWS[view];
  if (view === 'game') placeCamera(gameFrame.target, v.elevation, v.yaw, gameFrame.d);
  // The line-up is five minis wide, so a narrow phone screen backs off further.
  else placeCamera(v.focus, v.elevation, v.yaw, gameFrame.d * v.zoom * (view === 'lineup' ? THREE.MathUtils.clamp(1.3 / camera.aspect, 1, 2.2) : 1));
  // Keep the tilt-shift's sharp band on the board's middle (or the view's focus).
  const f = (view === 'game' ? new THREE.Vector3(0, 0.6, -0.3) : v.focus).clone().project(camera);
  post.setFocus((f.y + 1) / 2);
  post.setBlur(view === 'game' ? BLUR : BLUR * 1.6);
}

// Screen px at the bottom taken by the HUD, with the shop panel open or hidden.
const hud = document.getElementById('hud');
const shopPanel = document.getElementById('shop');
function hudInset(open) {
  const wasHidden = shopPanel.hidden;
  shopPanel.hidden = !open;
  const top = hud.getBoundingClientRect().top;
  shopPanel.hidden = wasHidden;
  return Math.max(0, innerHeight - top - 8);
}

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.resize(w, h);
  frames = { shop: frameGame(w, h, hudInset(true)), fight: frameGame(w, h, hudInset(false)) };
  gameFrame = wantedFrame();
  applyView();
}
addEventListener('resize', resize);
resize();

const units = createUnits(scene);
const playback = createPlayback(scene, units, camera);
const clock = createClock({ manual: TEST });
const debug = params.has('debug') ? createDebugOverlay(document.getElementById('fps'), renderer) : null;
const shopUI = createShopUI({
  scene, camera, canvas, tuning: TUNING,
  onBuy(slot) { if (screen === 'setup' && shop.buy(slot).ok) refreshSetup(); },
  onReroll() { if (screen === 'setup' && shop.reroll().ok) refreshSetup(); },
  onTap(row, col) { if (screen === 'setup' && shop.tap(row, col).ok) refreshSetup(); },
});

const fightBtn = document.getElementById('fight');
const banner = document.getElementById('banner');
const roundEl = document.getElementById('round');
const livesEl = document.getElementById('lives');
let screen = 'loading'; // loading | setup | battle | result | victory | defeat | lineup (test hook)
let loaded = false;
let result = null;

function placeBoards() {
  playback.stop();
  for (const e of shop.state.board) units.spawn(e.unit, 'player', e.col, globalRow('player', e.row), { star: e.star });
  for (const e of enemyBoard()) units.spawn(e.unit, 'enemy', e.col, globalRow('enemy', e.row), { star: e.star });
}

// Redraw the shop and the minis after any buy, reroll or tap.
function refreshSetup() {
  placeBoards();
  drawRunBar();
  shopUI.render(shop, true);
  const s = shop.state;
  fightBtn.disabled = !s.board.length && !s.held;
  if (TEST) render();
}

// Round counter and lives pips at the top.
function drawRunBar() {
  const r = run.state;
  roundEl.textContent = `Round ${r.round} of ${run.rounds}${r.round === run.rounds ? ' · Boss' : ''}`;
  livesEl.innerHTML = Array.from({ length: TUNING.economy.lives }, (_, i) => `<span class="pip${i < r.lives ? '' : ' lost'}"></span>`).join('');
  livesEl.setAttribute('aria-label', `${r.lives} of ${TUNING.economy.lives} lives left`);
}

function toSetup() {
  screen = 'setup';
  result = null;
  banner.hidden = true;
  banner.className = '';
  fightBtn.textContent = 'Fight';
  refreshSetup();
}

function fight() {
  result = run.fight({ enemy: testEnemy ?? undefined });
  if (!result) return;
  fought = { ...result.boards, seed: result.seed };
  shopUI.render(shop, false);
  playback.start(result);
  screen = 'battle';
  fightBtn.disabled = true;
  fightBtn.textContent = 'Fighting…';
}

// After the fight: the round's result, or the Victory / Defeat screen.
function showResult() {
  const r = run.state;
  screen = r.phase; // result | victory | defeat
  drawRunBar();
  const last = r.last;
  const left = `${r.lives} ${r.lives === 1 ? 'life' : 'lives'} left`;
  const n = last.round;
  if (screen === 'victory') {
    const wins = r.history.filter((h) => h.won).length;
    banner.innerHTML = `Victory<small>${wins === run.rounds ? `All ${run.rounds} rounds won` : `Survived all ${run.rounds} rounds, won ${wins}`} · ${left}</small>`;
  } else if (screen === 'defeat') {
    banner.innerHTML = `Defeat<small>Out of lives on round ${n}</small>`;
  } else if (last.won) {
    banner.innerHTML = `Round ${n} won<small>Cleared in ${last.duration.toFixed(1)} s · next: round ${n + 1}</small>`;
  } else {
    banner.innerHTML = `Round ${n} lost<small>${last.winner === 'draw' ? 'Time ran out · ' : ''}−1 life, ${left} · next: round ${n + 1}</small>`;
  }
  banner.className = screen === 'result' ? (last.won ? 'won' : 'lost') : `end ${screen}`;
  banner.hidden = false;
  fightBtn.textContent = screen === 'result' ? 'Next round' : 'Play again';
  fightBtn.disabled = false;
}

function playAgain() {
  seed += 1;
  run = createRun(TUNING, seed);
  shop = run.shop;
  testEnemy = null;
  toSetup();
}

fightBtn.addEventListener('click', () => {
  if (screen === 'setup') fight();
  else if (screen === 'result') { run.next(); toSetup(); }
  else if (screen === 'victory' || screen === 'defeat') playAgain();
});

units.ready.then(() => { loaded = true; toSetup(); resize(); });

function step(dt) {
  clock.tick(dt);
  if (screen === 'battle') {
    playback.update(dt);
    if (playback.done) showResult();
  }
  units.update(dt);
  glideCamera(dt);
}

function render() {
  post.render();
  debug?.frame();
}

function state() {
  return {
    screen,
    loaded,
    propsLoaded: !!scene.userData.propsLoaded,
    seed,
    fightSeed: fought.seed,
    round: run.state.round,
    roundName: run.roundName(),
    lives: run.state.lives,
    phase: run.state.phase,
    history: run.state.history.map((h) => ({ ...h })),
    time: Math.round(clock.time * 100) / 100,
    minis: units.count,
    models: units.list(),
    gold: shop.state.gold,
    offers: [...shop.state.offers],
    held: shop.state.held && { ...shop.state.held },
    board: shop.state.board.map((u) => ({ ...u })),
    enemy: enemyBoard().map((u) => ({ ...u })),
    lastMerge: shop.state.lastMerge,
    battle: playback.state(),
    view,
    frame: frameBounds(),
    result: result && screen !== 'battle' && screen !== 'setup' ? { winner: result.winner, duration: result.duration, survivors: result.survivors } : null,
    boards: { player: fought.player, enemy: fought.enemy }, // the boards of the last fight
    sim: result ? { winner: result.winner, duration: result.duration } : null,
  };
}

const fmtB = (b, k) => `${b[k + '0'].toFixed(2)}..${b[k + '1'].toFixed(2)}`;

function stateText() {
  const s = state();
  const b = s.battle;
  return [
    `screen: ${s.screen} (models ${s.loaded ? 'loaded' : 'loading'}, mug ${s.propsLoaded ? 'loaded' : 'loading'})`,
    `time: ${s.time}s, run seed ${s.seed}, last fight seed ${s.fightSeed ?? 'none'}`,
    `run: ${s.roundName} (round ${s.round} of ${run.rounds}), ${s.lives} lives, phase ${s.phase}; fights so far: ${s.history.map((h) => `r${h.round} ${h.won ? 'won' : 'lost'}`).join(', ') || 'none'}`,
    `gold: ${s.gold}; offers: ${s.offers.map((u) => (u ? `${u} (${TUNING.units[u].cost}g)` : 'sold')).join(', ')}; reroll ${TUNING.economy.rerollCost}g`,
    `hand: ${s.held ? `${s.held.unit} ${s.held.star}-star` : 'empty'}${s.lastMerge ? `; just merged a 2-star ${s.lastMerge.unit}` : ''}`,
    `board: player ${s.board.map((e) => `${e.unit}${e.star === 2 ? '★★' : ''}@r${e.row}c${e.col}`).join(', ') || 'empty'} vs enemy ${enemyBoard().map((e) => `${e.unit}@r${e.row}c${e.col}`).join(', ')}; ${s.minis} minis on the board`,
    `models: ${s.models.map((m) => `${m.unit}=${m.model} (${m.animation})`).join(', ') || 'none'}`,
    b ? `battle: t=${b.t}s; ${b.units.map((u) => `${u.unit} ${u.hp}hp ${u.animation} @${u.x},${u.y}`).join('; ')}` : 'battle: not running',
    b ? `effects: on screen ${Object.entries(b.effects).map(([k, n]) => `${k}×${n}`).join(', ') || 'none'}; this fight ${Object.entries(b.effectsSeen).map(([k, n]) => `${k}×${n}`).join(', ') || 'none'}` : 'effects: none',
    s.sim ? `sim decided: ${s.sim.winner} in ${s.sim.duration}s` : 'sim decided: nothing yet',
    s.result ? `result: ${s.result.winner}, survivors ${s.result.survivors.map((x) => `${x.unit} ${x.hp}hp`).join(', ') || 'none'}` : 'result: none',
    `look: view ${view}, camera fov ${camera.fov.toFixed(1)}, pixel ratio ${renderer.getPixelRatio()}, shadow map ${quality.shadowMap}, tilt-shift on, lamp at ${lampHead.toArray().map((n) => n.toFixed(1)).join(',')}`,
    `framing: board frame on screen x ${fmtB(frameBounds(), 'x')}, y ${fmtB(frameBounds(), 'y')} (-1..1; inside means no clipping)`,
  ].join('\n');
}

window.__game = {
  test: TEST,
  state,
  stateText,
  // Where a cell on your half (local row 0 = front) is on screen, so the check can tap it.
  cellToScreen: (row, col) => shopUI.cellToScreen(row, col),
  // Test hook: put these boards out (local rows, as in tuning.rounds) and go back to setup.
  setBoards(player, enemy) {
    shop.setBoard(player);
    testEnemy = enemy;
    toSetup();
    return state();
  },
  // Test hook: every fight in this run is against this enemy board (local rows)
  // instead of the round's; "Play again" goes back to the real boards.
  setEnemy(enemy) {
    testEnemy = enemy;
    toSetup();
    return state();
  },
  // Line-up hook: every hero on your front row and every skeleton on theirs,
  // all facing the camera with name plates, so one shot shows all nine minis.
  // setBoards() goes back to the normal board.
  lineup() {
    playback.stop();
    shopUI.render(shop, false);
    banner.hidden = true;
    screen = 'lineup';
    const heroes = Object.keys(TUNING.units);
    const dead = Object.keys(TUNING.enemies);
    heroes.forEach((k, i) => units.spawn(k, 'player', i + (5 - heroes.length) / 2, globalRow('player', 0), { label: TUNING.units[k].name }).group.rotation.y = 0);
    dead.forEach((k, i) => units.spawn(k, 'enemy', i + (5 - dead.length) / 2, globalRow('enemy', 0), { label: TUNING.enemies[k].name.replace('Skeleton ', '') }).group.rotation.y = 0);
    render();
    return state();
  },
  // Look-sheet hook: switch camera to 'game', 'low', 'lamp' or 'lineup' and draw a frame.
  setView(name) {
    if (!VIEWS[name]) throw new Error(`unknown view ${name}`);
    view = name;
    applyView();
    playback.refresh();
    render();
    return state();
  },
  // Test clock: advance simulated time in fixed steps, then draw one frame.
  advance(ms) {
    const n = Math.round(ms / 1000 / STEP);
    for (let i = 0; i < n; i++) step(STEP);
    render();
    return state();
  },
};

if (TEST) {
  render();
} else {
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    step(dt);
    render();
  });
}
