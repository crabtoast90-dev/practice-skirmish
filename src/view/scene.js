import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeRng, COLS, ROWS_PER_SIDE } from '../sim/battle.js';

// Board layout in world space. One cell = CELL metres; the board is centred on
// the origin, the player's half towards +Z (nearest the camera).
export const CELL = 1.2;
const ROWS = ROWS_PER_SIDE * 2;
const FIELD_W = COLS * CELL;
const FIELD_D = ROWS * CELL;
const BORDER = 0.42; // frame width around the playing field
const BOARD_W = FIELD_W + BORDER * 2;
const BOARD_D = FIELD_D + BORDER * 2;
const BOARD_H = 0.28; // top of the playing field
const FRAME_LIP = 0.05; // the frame stands this far above the field
const BEVEL = 0.06;
export const BOARD_TOP = BOARD_H;

// Sim coordinates (x = column 0-4, y = row 0-5, player rows 0-2) to world.
export function cellToWorld(x, y) {
  return new THREE.Vector3((x - (COLS - 1) / 2) * CELL, BOARD_TOP, ((ROWS - 1) / 2 - y) * CELL);
}

// Palette shared by the table, board, lamp and lights.
export const PALETTE = {
  room: 0x0f131c,
  table: '#4a2e1c',
  tableGrain: '#2c1a0f',
  playerWood: '#c09058', // honey oak
  playerGrain: '#8a5d33',
  enemyWood: '#7a4529', // cherry / walnut
  enemyGrain: '#4c2615',
  stringing: '#ead6a6', // pale maple inlay between cells
  frame: '#55301a',
  frameGrain: '#2a160b',
  lamp: 0xffc98a,
  lampBrass: 0xb3884a,
  lampShade: 0x2f6b4c,
  fill: 0x51607f,
  rim: 0x8aa0d0,
};

// Wood grain streaks inside a rectangle, either along x or along y.
function drawGrain(g, rng, x, y, w, h, base, grain, { vertical = false, streaks = 30 } = {}) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  // Gentle per-piece tone change so neighbouring pieces read as separate wood.
  g.fillStyle = rng() < 0.5 ? '#000' : '#fff';
  g.globalAlpha = 0.03 + rng() * 0.05;
  g.fillRect(x, y, w, h);
  g.strokeStyle = grain;
  const len = vertical ? h : w;
  const across = vertical ? w : h;
  for (let i = 0; i < streaks; i++) {
    const o = rng() * across;
    g.globalAlpha = 0.08 + rng() * 0.25;
    g.lineWidth = 0.6 + rng() * 2.2;
    const wobble = 1.5 + rng() * 5;
    const freq = 0.006 + rng() * 0.014;
    const phase = rng() * 6.28;
    g.beginPath();
    for (let s = 0; s <= len; s += 8) {
      const a = o + Math.sin(s * freq + phase) * wobble;
      if (vertical) g.lineTo(x + a, y + s); else g.lineTo(x + s, y + a);
    }
    g.stroke();
  }
  g.restore();
}

function canvasTexture(canvas, srgb = true) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function plainWood(size, base, grain, seed, streaks) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  drawGrain(canvas.getContext('2d'), makeRng(seed), 0, 0, size, size, base, grain, { streaks });
  const tex = canvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// The playing field: every cell is its own inlaid piece of wood (grain turning
// on alternate cells, like parquet), the two halves in different woods, with pale
// maple stringing between cells. A matching bump map sinks the stringing joints.
function fieldTextures() {
  const px = 192;
  const w = COLS * px;
  const h = ROWS * px;
  const color = document.createElement('canvas');
  const bump = document.createElement('canvas');
  color.width = bump.width = w;
  color.height = bump.height = h;
  const g = color.getContext('2d');
  const b = bump.getContext('2d');
  const rng = makeRng(11);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, w, h);
  for (let r = 0; r < ROWS; r++) {
    const enemy = r < ROWS_PER_SIDE; // top of the texture is the far (enemy) side
    for (let c = 0; c < COLS; c++) {
      drawGrain(g, rng, c * px, r * px, px, px,
        enemy ? PALETTE.enemyWood : PALETTE.playerWood,
        enemy ? PALETTE.enemyGrain : PALETTE.playerGrain,
        { vertical: (r + c) % 2 === 1, streaks: 26 });
    }
  }
  const line = (ctx, x0, y0, x1, y1, width, style) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  };
  // Stringing with thin dark glue lines either side, and grooves in the bump map.
  const strings = [];
  for (let c = 0; c <= COLS; c++) strings.push([c * px, 0, c * px, h]);
  for (let r = 0; r <= ROWS; r++) strings.push([0, r * px, w, r * px]);
  for (const s of strings) {
    line(g, ...s, 9, 'rgba(30,15,6,0.7)');
    line(g, ...s, 5, PALETTE.stringing);
    line(b, ...s, 9, '#5a5a5a');
    line(b, ...s, 4, '#707070');
  }
  // The centre line between the halves: a broader band of dark wood with stringing.
  const mid = ROWS_PER_SIDE * px;
  line(g, 0, mid, w, mid, 18, PALETTE.stringing);
  line(g, 0, mid, w, mid, 10, '#2a160b');
  line(b, 0, mid, w, mid, 18, '#606060');
  // A little wear and varnish dust.
  g.globalAlpha = 0.05;
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rng() < 0.5 ? '#000' : '#fff';
    g.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
  }
  g.globalAlpha = 1;
  return { map: canvasTexture(color), bump: canvasTexture(bump, false) };
}

// A rounded rectangle path in the XY plane, centred on the origin.
function roundedRect(shape, w, h, r) {
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

function createBoard() {
  const board = new THREE.Group();
  const { map, bump } = fieldTextures();
  const field = new THREE.Mesh(
    new THREE.BoxGeometry(FIELD_W, BOARD_H, FIELD_D),
    [null, null, new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 1.2, roughness: 0.55 }), null, null, null]
      .map((m) => m ?? new THREE.MeshStandardMaterial({ color: PALETTE.frame, roughness: 0.7 })),
  );
  field.position.y = BOARD_H / 2;
  field.receiveShadow = true;
  board.add(field);

  // Frame: a rounded slab with the field cut out, extruded upwards with a bevel.
  const outer = roundedRect(new THREE.Shape(), BOARD_W - BEVEL * 2, BOARD_D - BEVEL * 2, 0.16);
  outer.holes.push(roundedRect(new THREE.Path(), FIELD_W + BEVEL * 2, FIELD_D + BEVEL * 2, 0.02));
  const depth = BOARD_H + FRAME_LIP - BEVEL * 2;
  const geo = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 3, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, BEVEL, 0);
  const frameTex = plainWood(512, PALETTE.frame, PALETTE.frameGrain, 5, 70);
  frameTex.repeat.set(0.25, 0.25);
  const frame = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: frameTex, roughness: 0.42, metalness: 0.0 }));
  frame.castShadow = true;
  frame.receiveShadow = true;
  board.add(frame);

  // Brass corner caps, small, catching the lamp.
  const brass = new THREE.MeshStandardMaterial({ color: PALETTE.lampBrass, metalness: 0.85, roughness: 0.32 });
  const capGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.02, 20);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cap = new THREE.Mesh(capGeo, brass);
      cap.position.set(sx * (BOARD_W / 2 - 0.2), BOARD_H + FRAME_LIP + 0.01, sz * (BOARD_D / 2 - 0.2));
      board.add(cap);
    }
  }
  return board;
}

// A cylinder from point a to point b.
function rod(a, b, r, mat) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,236,200,1)');
  grad.addColorStop(0.25, 'rgba(255,190,110,0.45)');
  grad.addColorStop(1, 'rgba(255,160,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return canvasTexture(c);
}

// An articulated brass desk lamp with a green enamel shade, standing on the
// table to the left and leaning over the board. Returns the bulb position.
function createLamp(base, head, aim) {
  const lamp = new THREE.Group();
  const brass = new THREE.MeshStandardMaterial({ color: PALETTE.lampBrass, metalness: 0.85, roughness: 0.3 });
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.16, 32), brass);
  foot.position.copy(base).setY(0.08);
  foot.castShadow = foot.receiveShadow = true;
  lamp.add(foot);
  const elbow = base.clone().add(new THREE.Vector3(0.35, 2.7, 0.25));
  const wrist = head.clone().add(aim.clone().sub(head).normalize().multiplyScalar(-0.55));
  lamp.add(rod(base.clone().setY(0.16), elbow, 0.055, brass));
  lamp.add(rod(elbow, wrist, 0.045, brass));
  for (const p of [elbow, wrist]) {
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), brass);
    knuckle.position.copy(p);
    lamp.add(knuckle);
  }
  // Shade: an open cone, green outside, warm cream inside, pointing at the board.
  const shadeGeo = new THREE.CylinderGeometry(0.16, 0.62, 0.7, 32, 1, true);
  const outside = new THREE.Mesh(shadeGeo, new THREE.MeshStandardMaterial({ color: PALETTE.lampShade, emissive: 0x10281b, roughness: 0.3, metalness: 0.3, side: THREE.FrontSide }));
  const inside = new THREE.Mesh(shadeGeo, new THREE.MeshBasicMaterial({ color: 0xffe2b0, side: THREE.BackSide }));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), brass);
  cap.position.y = 0.33;
  const shade = new THREE.Group();
  shade.add(outside, inside, cap);
  outside.castShadow = true;
  shade.position.copy(head);
  // The cylinder's wide end is -Y; turn -Y towards the aim point.
  shade.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), aim.clone().sub(head).normalize());
  lamp.add(shade);
  const bulbPos = head.clone().add(aim.clone().sub(head).normalize().multiplyScalar(0.12));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff4dc }));
  bulb.position.copy(bulbPos);
  lamp.add(bulb);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
  glow.position.copy(head.clone().add(aim.clone().sub(head).normalize().multiplyScalar(0.45)));
  glow.scale.setScalar(1.7);
  lamp.add(glow);
  return { lamp, bulbPos };
}

export function createScene(quality) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.room);
  scene.fog = new THREE.Fog(PALETTE.room, 16, 34);

  // Table: a big wooden plane that falls off into the dark room.
  const tableTex = plainWood(1024, PALETTE.table, PALETTE.tableGrain, 3, 260);
  tableTex.repeat.set(4, 4);
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 70),
    new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.62 }),
  );
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  scene.add(table);

  scene.add(createBoard());

  // The lamp: one warm spot from the lamp's bulb, low and to the left, so minis
  // cast long soft shadows across the board and the table falls off into the dark.
  const aim = new THREE.Vector3(0.4, 0, -0.5);
  const { lamp: lampModel, bulbPos } = createLamp(new THREE.Vector3(-6.7, 0, -2.6), new THREE.Vector3(-5.0, 3.3, -1.0), aim);
  scene.add(lampModel);
  const lamp = new THREE.SpotLight(PALETTE.lamp, 120, 30, Math.PI / 3.6, 0.75, 1.5);
  lamp.position.copy(bulbPos);
  lamp.target.position.copy(aim);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
  lamp.shadow.camera.near = 0.5;
  lamp.shadow.camera.far = 20;
  lamp.shadow.bias = -0.0003;
  lamp.shadow.normalBias = 0.02;
  lamp.shadow.radius = 5;
  lamp.shadow.blurSamples = 16;
  scene.add(lamp, lamp.target);

  // A small warm bounce near the lamp's foot so the brass reads, and the cool,
  // dim room: a blue-grey sky fill plus a faint moonlit rim from the back right.
  const bounce = new THREE.PointLight(PALETTE.lamp, 2.5, 6, 2);
  bounce.position.set(-5.2, 1.2, -1.6);
  scene.add(bounce);
  scene.add(new THREE.HemisphereLight(PALETTE.fill, 0x1a110a, 1.0));
  const rim = new THREE.DirectionalLight(PALETTE.rim, 0.6);
  rim.position.set(6, 5, -8);
  scene.add(rim);

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

  return { scene, lamp, lampHead: bulbPos, boardSize: { w: BOARD_W, d: BOARD_D, h: BOARD_H + FRAME_LIP } };
}
