import * as THREE from 'three';

// Combat effects: projectiles, special glows and bursts, hit flashes and floating
// damage numbers. View only: playback.js decides when and where from the sim's
// events; nothing here changes the fight. Times are in seconds, sizes in metres.

const UP = new THREE.Vector3(0, 1, 0);
const CHEST = 0.75; // projectiles fly at about chest height of a mini

// Colours per effect (all drawn without tone mapping, so they glow in the lamp light).
const COLORS = {
  arrow: 0xfff0c8,
  bolt: 0x9ab8ff, // Mage's normal attack
  boneBolt: 0xb8f07a, // Skeleton Mage's normal attack
  fireball: 0xff8a2a,
  bone: 0xc8ff8a,
  pierce: 0xffd84a,
  shield: 0x7fc4ff,
  cleave: 0xffd27a,
  leap: 0xb07aff,
  blow: 0xff6a3a,
  hit: 0xfff2d8,
};

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const glowMat = (tex, color, opacity = 1) => new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
const addMat = (color, opacity = 1, extra = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide, ...extra });

// A damage number on a small canvas: white on the dead, red on your minis, gold and bigger for specials.
const NUMBER_STYLE = {
  enemy: { color: '#fff4dc', size: 56 },
  player: { color: '#ff7a5c', size: 56 },
  special: { color: '#ffc94a', size: 76 },
};
function numberTexture(text, style) {
  const { color, size } = NUMBER_STYLE[style];
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 96;
  const g = c.getContext('2d');
  g.font = `900 ${size}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = size / 5;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(28,12,4,0.95)';
  g.strokeText(text, 80, 50);
  g.fillStyle = color;
  g.fillText(text, 80, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function arrowMesh(color, long = false) {
  const g = new THREE.Group();
  const len = long ? 0.7 : 0.5;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 5).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8a5a30, fog: false }));
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 6).rotateX(Math.PI / 2).translate(0, 0, len / 2 + 0.04), new THREE.MeshBasicMaterial({ color: 0xd8d8e0, fog: false }));
  const fletch = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.1).rotateX(Math.PI / 2).translate(0, 0, -len / 2 + 0.05), new THREE.MeshBasicMaterial({ color: 0xf2e6c8, side: THREE.DoubleSide, fog: false }));
  // A glowing streak behind the arrow so it reads at board scale.
  const streak = new THREE.Mesh(new THREE.CylinderGeometry(long ? 0.06 : 0.02, 0.005, long ? 2 : 0.8, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, long ? -1.1 : -0.45), addMat(color, long ? 1 : 0.5));
  g.add(shaft, head, fletch, streak);
  return g;
}

export function createEffects(scene, camera) {
  const glow = glowTexture();
  const live = []; // { name, age, life, obj?, tick(age, k), end?() }
  const queue = []; // { at, fn } delayed calls (e.g. a hit number when the arrow lands)
  const numbers = new Map(); // text|style -> texture
  const counts = {}; // effects started, per name, since the last clear()
  let clock = 0;
  let jitter = 0; // deterministic spread for damage numbers, so test screenshots repeat

  function add(name, life, obj, tick, end) {
    if (obj) scene.add(obj);
    const fx = { name, age: 0, life, obj, tick, end };
    live.push(fx);
    counts[name] = (counts[name] ?? 0) + 1;
    tick(0, 0);
    return fx;
  }
  const sprite = (color, size, opacity = 1) => {
    const s = new THREE.Sprite(glowMat(glow, color, opacity));
    s.scale.setScalar(size);
    s.renderOrder = 15;
    return s;
  };
  const later = (delay, fn) => (delay <= 0 ? fn() : queue.push({ at: clock + delay, fn }));
  const posOf = (p) => (typeof p === 'function' ? p() : p).clone();
  const chest = (p) => posOf(p).add(new THREE.Vector3(0, CHEST, 0));

  // A fading spark left behind by fireballs and bolts.
  function ember(pos, color, size, life) {
    const s = sprite(color, size, 0.8);
    s.position.copy(pos);
    add('ember', life, s, (age, k) => { s.material.opacity = 0.8 * (1 - k); s.scale.setScalar(size * (1 - 0.6 * k)); });
  }

  // Anything that flies: from and to are positions or functions returning one (the target
  // keeps moving). beyond: keep flying this far past the target (Piercing Arrow).
  function projectile(kind, from, to, { speed, arc = 0, beyond = 0, onArrive } = {}) {
    const a = chest(from);
    const b0 = chest(to);
    const dist = a.distanceTo(b0);
    const flight = Math.max(0.08, dist / speed);
    const total = flight + beyond / speed;
    let obj;
    if (kind === 'arrow' || kind === 'pierce') obj = arrowMesh(COLORS[kind], kind === 'pierce');
    let trail = null;
    if (kind === 'pierce') {
      const tip = sprite(COLORS.pierce, 0.9);
      tip.position.z = 0.3;
      obj.add(tip);
      // A golden line left along the arrow's whole path, fading once it's gone by.
      trail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5), addMat(COLORS.pierce, 0.8));
      trail.position.copy(a);
      trail.scale.z = 0.01;
      add('trail', total, trail, () => {}); // moved by the arrow's tick below
    }
    else {
      const color = COLORS[kind];
      const big = kind === 'fireball' || kind === 'bone';
      obj = new THREE.Group();
      obj.add(new THREE.Mesh(new THREE.SphereGeometry(big ? 0.13 : 0.07, 12, 8), addMat(0xffffff, 1)));
      obj.add(sprite(color, big ? 0.9 : 0.45));
    }
    let arrived = false;
    let last = a.clone();
    let tick = 0;
    const fx = add(kind, total, obj, (age) => {
      const b = chest(to);
      const s = Math.min(1, age / flight);
      const p = a.clone().lerp(b, s);
      if (age > flight) p.add(b.clone().sub(a).normalize().multiplyScalar((age - flight) * speed));
      p.y += Math.sin(Math.PI * s) * arc;
      if (p.distanceToSquared(last) > 1e-8) obj.lookAt(p.clone().add(p.clone().sub(last)));
      last = p;
      obj.position.copy(p);
      if (kind !== 'arrow' && kind !== 'pierce' && (tick++ % 2 === 0) && age > 0) ember(p, COLORS[kind], kind === 'fireball' || kind === 'bone' ? 0.45 : 0.22, 0.3);
      if (trail) {
        trail.lookAt(p);
        trail.scale.set(1, 1, Math.max(0.01, a.distanceTo(p)));
        trail.material.opacity = 0.8 * Math.max(0, 1 - Math.max(0, age - total + 0.25) / 0.25);
      }
      if (!arrived && age >= flight) { arrived = true; onArrive?.(b); }
    });
    fx.flight = flight;
    return fx;
  }

  // Area burst on the ground (Fireball, Bone Burst): a flash, an expanding ring
  // the size of the blast, and embers or bone shards thrown outward.
  function burst(kind, at, radius) {
    const color = COLORS[kind];
    const ground = posOf(at).add(new THREE.Vector3(0, 0.03, 0));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2), addMat(color, 0.9));
    ring.position.copy(ground);
    ring.renderOrder = 14;
    add(kind === 'bone' ? 'boneBurst' : 'fireburst', 0.6, ring, (age, k) => {
      ring.scale.setScalar(radius * (0.25 + 0.85 * Math.sqrt(k)));
      ring.material.opacity = 0.9 * (1 - k);
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), addMat(color, 0.4));
    disc.position.copy(ground);
    add('scorch', 0.5, disc, (age, k) => { disc.scale.setScalar(radius * Math.min(1, k * 3)); disc.material.opacity = 0.4 * (1 - k); });
    const flash = sprite(kind === 'bone' ? 0xe8ffd0 : 0xffd090, radius * 2.2);
    flash.position.copy(ground).add(new THREE.Vector3(0, 0.5, 0));
    add('flash', 0.35, flash, (age, k) => { flash.material.opacity = 1 - k; flash.scale.setScalar(radius * (1.4 + 1.6 * k)); });
    const pieces = 10;
    for (let i = 0; i < pieces; i++) {
      const ang = (i / pieces) * Math.PI * 2 + 0.3;
      const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
      const up = 1.6 + (i % 3) * 0.5;
      let piece;
      if (kind === 'bone') {
        piece = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.18), new THREE.MeshBasicMaterial({ color: 0xf0ead8, fog: false, transparent: true }));
      } else {
        piece = sprite(color, 0.28);
      }
      add('shard', 0.55, piece, (age, k) => {
        piece.position.copy(ground).addScaledVector(dir, radius * 0.9 * k + 0.1).add(new THREE.Vector3(0, 0.2 + up * age - 4.5 * age * age, 0));
        piece.rotation.set(age * 9, ang, age * 5);
        piece.material.opacity = 1 - k * k;
      });
    }
  }

  // Shield Wall: a translucent dome over the Knight with a glowing ring at its feet, until it drops.
  function shield(follow, life, alive) {
    const g = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.75, 1), addMat(COLORS.shield, 0.4));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.64, 32).rotateX(-Math.PI / 2), addMat(COLORS.shield, 1));
    ring.position.y = 0.12;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.035, 6, 32).rotateX(Math.PI / 2), addMat(0xd8f0ff, 1));
    rim.position.y = 0.55;
    g.add(dome, ring, rim);
    g.renderOrder = 13;
    const fx = add('shield', life, g, (age, k) => {
      g.position.copy(posOf(follow));
      const fadeIn = Math.min(1, age / 0.2);
      const fadeOut = Math.min(1, (life - age) / 0.3);
      const a = Math.max(0, Math.min(fadeIn, fadeOut));
      const pulse = 1 + 0.06 * Math.sin(age * 9);
      dome.material.opacity = 0.4 * a * pulse;
      ring.material.opacity = a;
      rim.material.opacity = a;
      rim.position.y = 0.3 + 0.7 * ((age * 0.8) % 1);
      g.scale.setScalar((0.85 + 0.15 * fadeIn) * pulse);
      if (!alive()) fx.age = Math.max(fx.age, life - 0.3);
    });
    return fx;
  }

  // Cleave: a bright crescent swept around the Barbarian, centred on its target.
  function cleave(at, toward, radius) {
    const p = posOf(at);
    const dir = posOf(toward).sub(p);
    const yaw = Math.atan2(dir.x, dir.z);
    const span = Math.PI * 1.25;
    const arc = new THREE.Mesh(new THREE.RingGeometry(0.62, 1, 32, 1, -span / 2, span), addMat(COLORS.cleave, 0.9));
    const g = new THREE.Group();
    g.add(arc);
    arc.rotation.x = -Math.PI / 2;
    g.position.copy(p).add(new THREE.Vector3(0, 0.55, 0));
    add('cleave', 0.45, g, (age, k) => {
      // RingGeometry's 0 angle points +X; turn it to face the target and sweep across.
      g.rotation.y = yaw - Math.PI / 2 + (k - 0.5) * 1.2;
      g.scale.setScalar(radius * (0.7 + 0.45 * k));
      arc.material.opacity = 0.9 * (1 - k * k);
    });
  }

  // Shadow Leap: a violet arc traced from where the Rogue took off to where it landed, with puffs at both ends.
  function leap(from, to, height) {
    const a = posOf(from).add(new THREE.Vector3(0, 0.4, 0));
    const b = posOf(to).add(new THREE.Vector3(0, 0.4, 0));
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, height * 2, 0));
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const geo = new THREE.TubeGeometry(curve, 32, 0.06, 6, false);
    const tube = new THREE.Mesh(geo, addMat(COLORS.leap, 0.9));
    const count = geo.index.count;
    add('leap', 0.8, tube, (age, k) => {
      // Draw the trail growing over the hop, then fade it.
      geo.setDrawRange(0, Math.ceil(count * Math.min(1, age / 0.4) / 6) * 6);
      tube.material.opacity = 0.9 * (1 - Math.max(0, (age - 0.35) / 0.45));
    });
    for (const [p, delay] of [[a, 0], [b, 0.4]]) {
      later(delay, () => {
        const puff = sprite(0x8a6ac8, 0.6, 0.9);
        puff.position.copy(p);
        add('puff', 0.5, puff, (age, k) => { puff.scale.setScalar(0.6 + 1.2 * k); puff.material.opacity = 0.9 * (1 - k); });
      });
    }
  }

  // Heavy Blow / Backstab: a hot ring slammed out from the target.
  function slam(at) {
    const p = posOf(at).add(new THREE.Vector3(0, 0.05, 0));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1, 32).rotateX(-Math.PI / 2), addMat(COLORS.blow, 0.9));
    ring.position.copy(p);
    add('blow', 0.4, ring, (age, k) => { ring.scale.setScalar(0.3 + 0.7 * k); ring.material.opacity = 0.9 * (1 - k); });
  }

  // A small white pop on whoever got hit.
  function hitFlash(at, big = false) {
    const s = sprite(COLORS.hit, big ? 0.9 : 0.6, 1);
    s.position.copy(chest(at));
    add('hit', 0.18, s, (age, k) => { s.scale.setScalar((big ? 0.9 : 0.6) * (1 + k)); s.material.opacity = 1 - k; });
  }

  // A damage number that floats up off the mini and fades.
  function number(at, amount, style) {
    const text = String(amount);
    const key = `${text}|${style}`;
    if (!numbers.has(key)) {
      if (numbers.size > 400) { for (const t of numbers.values()) t.dispose(); numbers.clear(); }
      numbers.set(key, numberTexture(text, style));
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: numbers.get(key), transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    s.renderOrder = 20;
    const h = style === 'special' ? 0.5 : 0.42;
    jitter = (jitter + 1) % 5;
    const start = posOf(at).add(new THREE.Vector3((jitter - 2) * 0.12, 1.75, 0));
    add('number', 0.9, s, (age, k) => {
      const pop = 1 + 0.35 * Math.max(0, 1 - age / 0.12);
      s.scale.set(h * 160 / 96 * pop, h * pop, 1);
      s.position.copy(start).addScaledVector(UP, 0.7 * Math.sqrt(k));
      s.material.opacity = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
    });
  }

  function remove(fx) {
    if (fx.obj) {
      scene.remove(fx.obj);
      fx.obj.traverse((o) => {
        if (!o.isSprite) o.geometry?.dispose(); // sprites share one geometry; maps are cached textures
        o.material?.dispose();
      });
    }
  }

  return {
    projectile, burst, shield, cleave, leap, slam, hitFlash, number, later,
    update(dt) {
      clock += dt;
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].at <= clock) queue.splice(i, 1)[0].fn();
      for (let i = live.length - 1; i >= 0; i--) {
        const fx = live[i];
        fx.age += dt;
        if (fx.age >= fx.life) { fx.tick(fx.life, 1); live.splice(i, 1); remove(fx); continue; } // last tick lands projectiles
        fx.tick(fx.age, fx.age / fx.life);
      }
    },
    clear() {
      for (const fx of live.splice(0)) remove(fx);
      queue.length = 0;
      for (const k of Object.keys(counts)) delete counts[k];
    },
    // What's on screen now, by name (for stateText), and how many of each started this fight.
    active() {
      const n = {};
      for (const fx of live) n[fx.name] = (n[fx.name] ?? 0) + 1;
      return n;
    },
    get counts() { return { ...counts }; },
  };
}
