import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeRng, COLS, ROWS_PER_SIDE } from '../sim/battle.js';

// Board layout in world space. One cell = CELL metres; the board is centred on
// the origin, the player's half towards +Z (nearest the camera).
export const CELL = 1.2;
const ROWS = ROWS_PER_SIDE * 2;
const BORDER = 0.35;
const BOARD_W = COLS * CELL + BORDER * 2;
const BOARD_D = ROWS * CELL + BORDER * 2;
const BOARD_H = 0.28;
export const BOARD_TOP = BOARD_H;

// Sim coordinates (x = column 0-4, y = row 0-5, player rows 0-2) to world.
export function cellToWorld(x, y) {
  return new THREE.Vector3((x - (COLS - 1) / 2) * CELL, BOARD_TOP, ((ROWS - 1) / 2 - y) * CELL);
}

// Palette shared by the table, board and lights.
export const PALETTE = {
  room: 0x140d08,
  table: '#6b4228',
  tableGrain: '#4a2b18',
  board: '#a8743f',
  boardGrain: '#7d5230',
  playerHalf: 'rgba(255,236,190,0.12)',
  enemyHalf: 'rgba(70,22,8,0.30)',
  gridLine: 'rgba(50,28,12,0.55)',
  frame: '#5a341c',
  lamp: 0xffc27a,
  fill: 0x8796b8,
};

// Procedural wood: seeded grain streaks on a canvas.
function woodTexture(w, h, base, grain, seed, { streaks = 140, drawExtra } = {}) {
  const rng = makeRng(seed);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = grain;
  for (let i = 0; i < streaks; i++) {
    const y0 = rng() * h;
    g.globalAlpha = 0.08 + rng() * 0.22;
    g.lineWidth = 0.6 + rng() * 2.4;
    g.beginPath();
    g.moveTo(0, y0);
    const wobble = 2 + rng() * 6;
    const freq = 0.004 + rng() * 0.01;
    for (let x = 0; x <= w; x += 16) g.lineTo(x, y0 + Math.sin(x * freq + i) * wobble);
    g.stroke();
  }
  g.globalAlpha = 1;
  drawExtra?.(g, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function boardTopTexture() {
  const px = 160; // texture pixels per cell
  const w = Math.round(BOARD_W / CELL * px);
  const h = Math.round(BOARD_D / CELL * px);
  const b = BORDER / CELL * px;
  return woodTexture(w, h, PALETTE.board, PALETTE.boardGrain, 7, {
    streaks: 220,
    drawExtra(g) {
      // Halves: enemy at the top of the texture (far side), player at the bottom.
      g.fillStyle = PALETTE.enemyHalf;
      g.fillRect(b, b, COLS * px, ROWS_PER_SIDE * px);
      g.fillStyle = PALETTE.playerHalf;
      g.fillRect(b, b + ROWS_PER_SIDE * px, COLS * px, ROWS_PER_SIDE * px);
      // Grid lines, burnt into the wood.
      g.strokeStyle = PALETTE.gridLine;
      g.lineWidth = 4;
      for (let c = 0; c <= COLS; c++) {
        g.beginPath(); g.moveTo(b + c * px, b); g.lineTo(b + c * px, b + ROWS * px); g.stroke();
      }
      for (let r = 0; r <= ROWS; r++) {
        g.beginPath(); g.moveTo(b, b + r * px); g.lineTo(b + COLS * px, b + r * px); g.stroke();
      }
      // The middle line, thicker.
      g.lineWidth = 9;
      g.beginPath(); g.moveTo(b, b + ROWS_PER_SIDE * px); g.lineTo(b + COLS * px, b + ROWS_PER_SIDE * px); g.stroke();
    },
  });
}

export function createScene(quality) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.room);

  // Table: a big wooden plane that falls off into the dark room.
  const tableTex = woodTexture(1024, 1024, PALETTE.table, PALETTE.tableGrain, 3, { streaks: 260 });
  tableTex.wrapS = tableTex.wrapT = THREE.RepeatWrapping;
  tableTex.repeat.set(3, 3);
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.75 }),
  );
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  scene.add(table);

  // Board: a slab with the grid on top and a darker frame on the sides.
  const side = new THREE.MeshStandardMaterial({ color: PALETTE.frame, roughness: 0.7 });
  const top = new THREE.MeshStandardMaterial({ map: boardTopTexture(), roughness: 0.6 });
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z.
  const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W, BOARD_H, BOARD_D), [side, side, top, side, side, side]);
  board.position.y = BOARD_H / 2;
  board.castShadow = true;
  board.receiveShadow = true;
  scene.add(board);

  // Lamp: one warm, soft-edged spot from the left, high up, so minis cast long shadows across the board.
  const lamp = new THREE.SpotLight(PALETTE.lamp, 420, 40, Math.PI / 4.6, 0.8, 1.6);
  lamp.position.set(-7, 9, 3);
  lamp.target.position.set(0.6, 0, -0.4);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
  lamp.shadow.camera.near = 4;
  lamp.shadow.camera.far = 25;
  lamp.shadow.bias = -0.0004;
  lamp.shadow.normalBias = 0.02;
  lamp.shadow.radius = 4;
  scene.add(lamp, lamp.target);

  // Cool, dim room fill so shadow sides aren't black.
  scene.add(new THREE.HemisphereLight(PALETTE.fill, 0x2a1a10, 0.6));

  // A mug of ale at the table's edge, for scale.
  new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/props/mug_full.gltf`).then((g) => {
    const mug = g.scene;
    mug.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const box = new THREE.Box3().setFromObject(mug);
    const s = 1.0 / (box.max.y - box.min.y);
    mug.scale.setScalar(s);
    mug.position.set(BOARD_W / 2 + 1.3, -box.min.y * s, -1.6);
    mug.rotation.y = -0.6;
    scene.add(mug);
    scene.userData.propsLoaded = true;
  });

  return { scene, lamp, boardSize: { w: BOARD_W, d: BOARD_D } };
}
