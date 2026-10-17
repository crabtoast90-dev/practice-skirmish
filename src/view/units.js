import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { cellToWorld } from './scene.js';
import { makeRng } from '../sim/battle.js';

const DIR = `${import.meta.env.BASE_URL}models/units/`;
const HEIGHT = 1.3; // minis stand a bit taller than a cell is wide, so they read on a phone
const FADE = 0.15;
export const BASE_H = 0.09; // minis stand on this

// Round bases like painted tabletop figures: a bevelled disc with a painted rim
// in the side's colour, and a flocked top (grass for heroes, ash for the dead).
const BASE_STYLE = {
  player: { rim: 0x24395a, flock: ['#4f6a2c', '#6d8a38', '#3a4f22', '#8a7a4a'] },
  enemy: { rim: 0x5a1a17, flock: ['#5a5650', '#3e3a36', '#6e665a', '#2c2824'] },
};
let baseParts = null;
function flockTexture(colors, seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const rng = makeRng(seed);
  g.fillStyle = colors[0];
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = colors[Math.floor(rng() * colors.length)];
    g.fillRect(rng() * 128, rng() * 128, 1 + rng() * 3, 1 + rng() * 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function makeBase(side) {
  if (!baseParts) {
    const R = 0.44;
    // Side profile, from the centre bottom out and up over a rounded top edge.
    const pts = [[0, 0], [R, 0], [R, BASE_H * 0.55], [R - 0.015, BASE_H * 0.8], [R - 0.04, BASE_H * 0.97], [R - 0.06, BASE_H]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    baseParts = { rimGeo: new THREE.LatheGeometry(pts, 40), topGeo: new THREE.CircleGeometry(R - 0.06, 40).rotateX(-Math.PI / 2).translate(0, BASE_H + 0.001, 0) };
    for (const [k, st] of Object.entries(BASE_STYLE)) {
      baseParts[k] = {
        rim: new THREE.MeshStandardMaterial({ color: st.rim, roughness: 0.35 }),
        top: new THREE.MeshStandardMaterial({ map: flockTexture(st.flock, k === 'player' ? 21 : 22), roughness: 0.95 }),
      };
    }
  }
  const m = baseParts[side];
  const g = new THREE.Group();
  const rim = new THREE.Mesh(baseParts.rimGeo, m.rim);
  const top = new THREE.Mesh(baseParts.topGeo, m.top);
  rim.castShadow = rim.receiveShadow = top.receiveShadow = true;
  g.add(rim, top);
  return g;
}

// Which model file each tuning unit key uses. Add the rest as the roster grows.
export const MODEL_FILES = {
  knight: 'Knight.glb',
  skeletonWarrior: 'Skeleton_Warrior.glb',
};

// Animation names in the shared KayKit Rig_Medium files.
const CLIPS = {
  idle: ['general', 'Idle_A'],
  walk: ['movement', 'Walking_A'],
  attack: ['melee', 'Melee_1H_Attack_Chop'],
  special: ['melee', 'Melee_Block'],
  hit: ['general', 'Hit_A'],
  death: ['general', 'Death_A'],
};
const ONCE = new Set(['attack', 'special', 'hit', 'death']);

// Until every mini has its own model (PLAN.md C1), the others borrow the
// Knight's, tinted and name-tagged so you can tell them apart on the board.
const STAND_IN = { barbarian: 0xd9774a, rogue: 0x6f8f5a, mage: 0x7d6ad8, ranger: 0x4f9a8a };
const STAR2_SCALE = 1.15;

function tagSprite(text, { color = '#ffd76a', size = 64, width = 256 } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = size + 16;
  const g = c.getContext('2d');
  g.font = `700 ${size}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = size / 6;
  g.strokeStyle = 'rgba(30,16,6,0.9)';
  g.strokeText(text, width / 2, c.height / 2);
  g.fillStyle = color;
  g.fillText(text, width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.renderOrder = 12;
  s.scale.set(width / c.height * 0.22, 0.22, 1);
  return s;
}

export function createUnits(scene) {
  const loader = new GLTFLoader();
  const load = (f) => loader.loadAsync(DIR + f);
  const models = {};
  const rigs = {};
  const live = [];

  const ready = Promise.all([
    load('Rig_Medium_General.glb').then((g) => (rigs.general = g)),
    load('Rig_Medium_MovementBasic.glb').then((g) => (rigs.movement = g)),
    load('Rig_Medium_CombatMelee.glb').then((g) => (rigs.melee = g)),
    ...Object.entries(MODEL_FILES).map(([k, f]) => load(f).then((g) => (models[k] = g.scene))),
  ]);

  // star: 2 = a merged 2-star (a touch bigger, with a star badge overhead).
  function spawn(unit, side, x, y, { star = 1 } = {}) {
    const standIn = !models[unit];
    const model = cloneSkinned(models[unit] ?? models.knight);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (standIn && STAND_IN[unit]) {
        o.material = o.material.clone();
        o.material.color.multiply(new THREE.Color(STAND_IN[unit]).lerp(new THREE.Color(0xffffff), 0.25));
      }
    });
    const box = new THREE.Box3().setFromObject(model);
    const height = HEIGHT * (star === 2 ? STAR2_SCALE : 1);
    model.scale.setScalar(height / (box.max.y - box.min.y));
    const group = new THREE.Group();
    model.position.y = BASE_H;
    group.add(makeBase(side), model);
    const tags = new THREE.Group();
    if (star === 2) {
      const badge = tagSprite('★★', { size: 72, width: 200 });
      badge.scale.multiplyScalar(2);
      badge.position.y = height + 0.65;
      tags.add(badge);
    }
    if (standIn) {
      const name = tagSprite(unit[0].toUpperCase() + unit.slice(1), { color: '#fff1d6', size: 48 });
      name.position.y = 0.12;
      tags.add(name);
    }
    group.add(tags);
    scene.add(group);

    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const [name, [rig, clipName]] of Object.entries(CLIPS)) {
      const a = mixer.clipAction(THREE.AnimationClip.findByName(rigs[rig].animations, clipName));
      if (ONCE.has(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      actions[name] = a;
    }
    const u = {
      unit, side, star, group, tags, mixer, animation: 'idle',
      facing: side === 'player' ? Math.PI : 0, // KayKit models face +Z; the player's side looks towards -Z
      setCell(cx, cy) { group.position.copy(cellToWorld(cx, cy)); },
      play(name) {
        if (u.animation === 'death') return;
        const next = actions[name];
        const cur = actions[u.animation];
        if (cur === next && !ONCE.has(name)) return;
        next.reset().play();
        if (cur !== next) cur.crossFadeTo(next, FADE, false);
        u.animation = name;
      },
      // After a one-shot clip finishes, go back to a loop.
      settle(loop) {
        const cur = actions[u.animation];
        if (u.animation === 'death') return;
        if (!ONCE.has(u.animation) || !cur.isRunning()) u.play(loop);
      },
      dispose() { scene.remove(group); mixer.stopAllAction(); },
    };
    actions.idle.play();
    mixer.update(0);
    group.rotation.y = u.facing;
    u.setCell(x, y);
    live.push(u);
    return u;
  }

  return {
    ready,
    spawn,
    update(dt) { for (const u of live) u.mixer.update(dt); },
    clear() { for (const u of live.splice(0)) u.dispose(); },
    get count() { return live.length; },
  };
}
