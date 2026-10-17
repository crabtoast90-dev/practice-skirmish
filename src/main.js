import * as THREE from 'three';
import { createScene } from './view/scene.js';
import { createUnits } from './view/units.js';
import { createPlayback } from './view/playback.js';
import { createPost } from './view/post.js';
import { createClock, STEP } from './clock.js';
import { createDebugOverlay } from './debug.js';
import { simulate, globalRow } from './sim/battle.js';
import { TUNING } from './tuning.js';
import { createShop } from './game/shop.js';
import { createShopUI } from './view/shopUI.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const phone = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const quality = { pixelRatio: 2, shadowMap: phone ? 1024 : 2048 };

// You buy and place your board in the shop; the enemy is one Skeleton Warrior
// until the round boards arrive (PLAN.md B2). Local rows: 0 = front.
let ENEMY_BOARD = [{ unit: 'skeletonWarrior', row: 0, col: 2 }];
let seed = Number(params.get('seed') ?? 1);
const shop = createShop(TUNING, seed);
let playerBoard = [];

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality.pixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const { scene, boardSize } = createScene(quality);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
const post = createPost(renderer, scene, camera, { blur: phone ? 5 : 7 });

// Frame the whole board from the player's side, looking down at about 50 degrees.
// On a tall phone screen the lens widens instead of backing far away, so minis stay big.
// `inset` px at the bottom belong to the shop panel: the board fits in the space above it.
const ELEVATION = THREE.MathUtils.degToRad(52);
const MIN_HFOV = THREE.MathUtils.degToRad(44);
function frameCamera(w, h, inset) {
  const hv = h - inset;
  const aspect = w / hv;
  const needV = 2 * Math.atan(Math.tan(MIN_HFOV / 2) / aspect);
  const vfov = THREE.MathUtils.degToRad(Math.max(32, THREE.MathUtils.radToDeg(needV)));
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(vfov / 2) * h / hv));
  camera.aspect = w / h;
  camera.setViewOffset(w, h, 0, inset / 2, w, h);
  camera.updateProjectionMatrix();
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const halfW = boardSize.w / 2 + 0.3;
  const halfD = (boardSize.d / 2) * Math.sin(ELEVATION) + 0.5;
  const d = Math.max(halfW / Math.tan(hfov / 2), halfD / Math.tan(vfov / 2));
  const target = new THREE.Vector3(0, 0.3, 0.25);
  camera.position.set(0, target.y + d * Math.sin(ELEVATION), target.z + d * Math.cos(ELEVATION));
  camera.lookAt(target);
}

// The camera keeps the same framing through shop and fight, measured with the shop open.
const hud = document.getElementById('hud');
const shopPanel = document.getElementById('shop');
function hudInset() {
  const wasHidden = shopPanel.hidden;
  shopPanel.hidden = false;
  const top = hud.getBoundingClientRect().top;
  shopPanel.hidden = wasHidden;
  return Math.max(0, innerHeight - top - 8);
}

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  frameCamera(w, h, hudInset());
  post.resize(w, h);
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
let screen = 'loading'; // loading | setup | battle | result
let loaded = false;
let result = null;

function placeBoards() {
  playback.stop();
  for (const e of shop.state.board) units.spawn(e.unit, 'player', e.col, globalRow('player', e.row), { star: e.star });
  for (const e of ENEMY_BOARD) units.spawn(e.unit, 'enemy', e.col, globalRow('enemy', e.row), { star: e.star });
}

// Redraw the shop and the minis after any buy, reroll or tap.
function refreshSetup() {
  placeBoards();
  shopUI.render(shop, true);
  const s = shop.state;
  fightBtn.disabled = !s.board.length && !s.held;
  if (TEST) render();
}

function toSetup() {
  screen = 'setup';
  result = null;
  banner.hidden = true;
  fightBtn.textContent = 'Fight';
  refreshSetup();
}

function fight() {
  playerBoard = shop.commit();
  shopUI.render(shop, false);
  result = simulate(TUNING, playerBoard, ENEMY_BOARD, seed);
  playback.start(result);
  screen = 'battle';
  fightBtn.disabled = true;
  fightBtn.textContent = 'Fighting…';
}

function showResult() {
  screen = 'result';
  const name = (u) => (TUNING.units[u.unit] ?? TUNING.enemies[u.unit]).name;
  const title = { player: 'Victory', enemy: 'Defeat', draw: 'Draw' }[result.winner];
  const who = result.survivors.length ? `${result.survivors.map((s) => name(s)).join(', ')} won in ${result.duration.toFixed(1)} s` : '';
  banner.innerHTML = `${title}<small>${who}</small>`;
  banner.hidden = false;
  fightBtn.textContent = 'Again';
  fightBtn.disabled = false;
}

fightBtn.addEventListener('click', () => {
  if (screen === 'setup') fight();
  else if (screen === 'result') { seed += 1; shop.refresh(); toSetup(); }
});

units.ready.then(() => { loaded = true; toSetup(); resize(); });

function step(dt) {
  clock.tick(dt);
  if (screen === 'battle') {
    playback.update(dt);
    if (playback.done) showResult();
  }
  units.update(dt);
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
    time: Math.round(clock.time * 100) / 100,
    minis: units.count,
    gold: shop.state.gold,
    offers: [...shop.state.offers],
    held: shop.state.held && { ...shop.state.held },
    board: shop.state.board.map((u) => ({ ...u })),
    lastMerge: shop.state.lastMerge,
    battle: playback.state(),
    result: result && screen === 'result' ? { winner: result.winner, duration: result.duration, survivors: result.survivors } : null,
    boards: { player: playerBoard, enemy: ENEMY_BOARD }, // the boards of the last fight
    sim: result ? { winner: result.winner, duration: result.duration } : null,
  };
}

function stateText() {
  const s = state();
  const b = s.battle;
  return [
    `screen: ${s.screen} (models ${s.loaded ? 'loaded' : 'loading'}, mug ${s.propsLoaded ? 'loaded' : 'loading'})`,
    `time: ${s.time}s, seed ${s.seed}`,
    `gold: ${s.gold}; offers: ${s.offers.map((u) => (u ? `${u} (${TUNING.units[u].cost}g)` : 'sold')).join(', ')}; reroll ${TUNING.economy.rerollCost}g`,
    `hand: ${s.held ? `${s.held.unit} ${s.held.star}-star` : 'empty'}${s.lastMerge ? `; just merged a 2-star ${s.lastMerge.unit}` : ''}`,
    `board: player ${s.board.map((e) => `${e.unit}${e.star === 2 ? '★★' : ''}@r${e.row}c${e.col}`).join(', ') || 'empty'} vs enemy ${ENEMY_BOARD.map((e) => `${e.unit}@r${e.row}c${e.col}`).join(', ')}; ${s.minis} minis on the board`,
    b ? `battle: t=${b.t}s; ${b.units.map((u) => `${u.unit} ${u.hp}hp ${u.animation} @${u.x},${u.y}`).join('; ')}` : 'battle: not running',
    s.sim ? `sim decided: ${s.sim.winner} in ${s.sim.duration}s` : 'sim decided: nothing yet',
    s.result ? `result: ${s.result.winner}, survivors ${s.result.survivors.map((x) => `${x.unit} ${x.hp}hp`).join(', ') || 'none'}` : 'result: none',
    `look: pixel ratio ${renderer.getPixelRatio()}, shadow map ${quality.shadowMap}, tilt-shift on`,
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
    ENEMY_BOARD = enemy;
    toSetup();
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
