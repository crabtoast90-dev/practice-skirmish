import * as THREE from 'three';

// Plays back a finished sim result. The sim already decided everything; this
// only moves the minis between recorded frames and fires animations on events.
const BAR_W = 0.7;
const BAR_H = 0.08;

function makeBar(side) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(BAR_W + 0.04, BAR_H + 0.04), new THREE.MeshBasicMaterial({ color: 0x1a120c, depthTest: false }));
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(BAR_W, BAR_H), new THREE.MeshBasicMaterial({ color: side === 'player' ? 0x7ccf5a : 0xd8573c, depthTest: false }));
  fg.position.z = 0.001;
  bg.renderOrder = 10;
  fg.renderOrder = 11;
  g.add(bg, fg);
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
    views = r.units.map((u, i) => units.spawn(u.unit, u.side, f0[i][0], f0[i][1]));
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
      bar.fg.position.x = -(BAR_W * (1 - frac)) / 2;
      bar.g.position.copy(v.group.position).add(new THREE.Vector3(0, 1.55, 0));
      bar.g.quaternion.copy(camera.quaternion);
      bar.g.visible = hp > 0;
    });
  }

  return {
    start,
    stop,
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
      return {
        t: Math.round(t * 100) / 100,
        units: views.map((v, i) => ({ unit: v.unit, side: v.side, animation: v.animation, hp: result.frames[Math.min(result.frames.length - 1, Math.floor(t / result.dt))][i][2] })),
      };
    },
  };
}
