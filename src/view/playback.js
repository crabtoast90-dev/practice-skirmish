import * as THREE from 'three';
import { BASE_H } from './units.js';

// Plays back a finished sim result. The sim already decided everything; this
// only moves the minis between recorded frames and fires animations on events.
const BAR_W = 0.72;
const BAR_H = 0.1;
const BAR_Y = 1.6 + BASE_H; // above the mini's head

// HP bars styled like small brass-rimmed plaques: a brass rim, a dark inset,
// and an enamel fill (green for heroes, ember red for the dead) with a sheen.
function pill(w, h) {
  const r = h / 2;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-w / 2 + r, h / 2);
  s.absarc(-w / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  return new THREE.ShapeGeometry(s, 8);
}
function fillTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 32);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.18, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const flat = (opts) => new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, toneMapped: false, fog: false, transparent: true, ...opts });
let barParts = null;
function makeBar(side) {
  if (!barParts) {
    barParts = {
      rimGeo: pill(BAR_W + 0.07, BAR_H + 0.07),
      insetGeo: pill(BAR_W + 0.02, BAR_H + 0.02),
      fillGeo: new THREE.PlaneGeometry(BAR_W, BAR_H).translate(BAR_W / 2, 0, 0), // grows from the left
      rim: flat({ color: 0xc89a52 }),
      inset: flat({ color: 0x1a100a }),
      player: flat({ map: fillTexture('#8fd65e', '#3d7a26') }),
      enemy: flat({ map: fillTexture('#e86a45', '#8a2414') }),
    };
  }
  const g = new THREE.Group();
  const rim = new THREE.Mesh(barParts.rimGeo, barParts.rim);
  const inset = new THREE.Mesh(barParts.insetGeo, barParts.inset);
  const fg = new THREE.Mesh(barParts.fillGeo, barParts[side]);
  fg.position.x = -BAR_W / 2;
  rim.renderOrder = 10;
  inset.renderOrder = 11;
  fg.renderOrder = 12;
  g.add(rim, inset, fg);
  return { g, fg };
}

export function createPlayback(scene, units, camera) {
  let result = null;
  let views = [];
  let bars = [];
  let t = 0;
  let nextEvent = 0;
  let done = false;

  function start(r) {
    stop();
    result = r;
    t = 0;
    nextEvent = 0;
    done = false;
    const f0 = r.frames[0];
    views = r.units.map((u, i) => units.spawn(u.unit, u.side, f0[i][0], f0[i][1], { star: u.star }));
    bars = r.units.map((u) => {
      const b = makeBar(u.side);
      scene.add(b.g);
      return b;
    });
    views.forEach((v) => (v.lastTarget = null));
    apply();
  }

  function stop() {
    units.clear();
    for (const b of bars) scene.remove(b.g);
    bars = [];
    views = [];
    result = null;
  }

  function apply() {
    const fi = Math.min(result.frames.length - 1, t / result.dt);
    const i0 = Math.floor(fi);
    const i1 = Math.min(result.frames.length - 1, i0 + 1);
    const k = fi - i0;
    const a = result.frames[i0];
    const b = result.frames[i1];
    views.forEach((v, i) => {
      const x = a[i][0] + (b[i][0] - a[i][0]) * k;
      const y = a[i][1] + (b[i][1] - a[i][1]) * k;
      const before = v.group.position.clone();
      v.setCell(x, y);
      const moved = v.group.position.distanceTo(before) > 1e-4;
      // Face where we're walking, else whoever we last swung at.
      const look = moved ? v.group.position.clone().sub(before) : v.lastTarget ? views[v.lastTarget].group.position.clone().sub(v.group.position) : null;
      if (look && look.lengthSq() > 1e-8) v.group.rotation.y = Math.atan2(look.x, look.z);
      v.settle(moved ? 'walk' : 'idle');
      const hp = a[i][2];
      const frac = Math.max(0, hp / result.units[i].maxHp);
      const bar = bars[i];
      bar.fg.scale.x = Math.max(0.001, frac);
      bar.g.position.copy(v.group.position).add(new THREE.Vector3(0, BAR_Y + (v.star === 2 ? 0.2 : 0), 0));
      bar.g.quaternion.copy(camera.quaternion);
      bar.g.visible = hp > 0;
    });
  }

  return {
    start,
    stop,
    refresh() { if (result) apply(); }, // e.g. after the camera moves, so HP bars face it
    get active() { return !!result; },
    get done() { return done; },
    get time() { return t; },
    update(dt) {
      if (!result) return;
      t = Math.min(t + dt, result.duration + 2.5); // linger on the end pose
      while (nextEvent < result.events.length && result.events[nextEvent].t <= t) {
        const e = result.events[nextEvent++];
        if (e.type === 'attack') { views[e.id].play('attack'); views[e.id].lastTarget = e.to; }
        if (e.type === 'special') views[e.id].play('special');
        if (e.type === 'death') views[e.id].play('death');
      }
      apply();
      if (t >= result.duration + 2.5) done = true;
    },
    state() {
      if (!result) return null;
      const frame = result.frames[Math.min(result.frames.length - 1, Math.floor(t / result.dt))];
      return {
        t: Math.round(t * 100) / 100,
        units: views.map((v, i) => ({ unit: v.unit, side: v.side, animation: v.animation, hp: frame[i][2], x: frame[i][0], y: frame[i][1] })),
      };
    },
  };
}
