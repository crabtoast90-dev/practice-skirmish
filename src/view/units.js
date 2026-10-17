import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { cellToWorld } from './scene.js';

const DIR = `${import.meta.env.BASE_URL}models/units/`;
const HEIGHT = 1.3; // minis stand a bit taller than a cell is wide, so they read on a phone
const FADE = 0.15;

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

  function spawn(unit, side, x, y) {
    const model = cloneSkinned(models[unit]);
    model.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    const box = new THREE.Box3().setFromObject(model);
    model.scale.setScalar(HEIGHT / (box.max.y - box.min.y));
    const group = new THREE.Group();
    group.add(model);
    scene.add(group);

    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const [name, [rig, clipName]] of Object.entries(CLIPS)) {
      const a = mixer.clipAction(THREE.AnimationClip.findByName(rigs[rig].animations, clipName));
      if (ONCE.has(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      actions[name] = a;
    }
    const u = {
      unit, side, group, mixer, animation: 'idle',
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
