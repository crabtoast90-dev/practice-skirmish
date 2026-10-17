import * as THREE from 'three';
import { cellToWorld, CELL, BOARD_TOP } from './scene.js';
import { COLS, ROWS_PER_SIDE, globalRow } from '../sim/battle.js';

// The shop panel and board taps. Draws what src/game/shop.js says and passes
// taps back; it never decides prices, odds or merges itself.
export function createShopUI({ scene, camera, canvas, tuning, onBuy, onReroll, onTap }) {
  const panel = document.getElementById('shop');
  const goldEl = document.getElementById('gold');
  const hintEl = document.getElementById('hint');
  const offersEl = document.getElementById('offers');
  const rerollBtn = document.getElementById('reroll');
  rerollBtn.addEventListener('click', () => onReroll());

  const cards = Array.from({ length: tuning.economy.offersPerRound }, (_, slot) => {
    const b = document.createElement('button');
    b.className = 'offer';
    b.dataset.slot = slot;
    b.addEventListener('click', () => onBuy(slot));
    offersEl.append(b);
    return b;
  });

  // Glowing cells on your half while a unit is in your hand.
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd38a, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending });
  const swapMat = glowMat.clone();
  swapMat.opacity = 0.05;
  const glowGeo = new THREE.PlaneGeometry(CELL * 0.9, CELL * 0.9);
  glowGeo.rotateX(-Math.PI / 2);
  const glows = [];
  for (let row = 0; row < ROWS_PER_SIDE; row++) {
    for (let col = 0; col < COLS; col++) {
      const m = new THREE.Mesh(glowGeo, glowMat);
      m.position.copy(cellToWorld(col, globalRow('player', row)));
      m.position.y += 0.004;
      m.visible = false;
      m.userData = { row, col };
      scene.add(m);
      glows.push(m);
    }
  }

  // Screen point to a cell on your half (local row 0 = front), or null.
  // A tap on a mini's body counts as its cell, not the cell behind it.
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_TOP);
  let occupied = [];
  function cellAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
    let best = null;
    let bestD = Infinity;
    for (const u of occupied) {
      const c = cellToWorld(u.col, globalRow('player', u.row));
      const box = new THREE.Box3(new THREE.Vector3(c.x - CELL * 0.35, c.y, c.z - CELL * 0.35), new THREE.Vector3(c.x + CELL * 0.35, c.y + 1.4, c.z + CELL * 0.35));
      const hit = ray.ray.intersectBox(box, new THREE.Vector3());
      if (hit && hit.distanceTo(ray.ray.origin) < bestD) { best = u; bestD = hit.distanceTo(ray.ray.origin); }
    }
    if (best) return { row: best.row, col: best.col };
    const p = ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!p) return null;
    const origin = cellToWorld(0, 0);
    const col = Math.round((p.x - origin.x) / CELL);
    const y = Math.round((origin.z - p.z) / CELL);
    const row = ROWS_PER_SIDE - 1 - y;
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS_PER_SIDE) return null;
    return { row, col };
  }

  let enabled = false;
  canvas.addEventListener('click', (e) => {
    if (!enabled) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (cell) onTap(cell.row, cell.col);
  });

  const name = (unit) => tuning.units[unit].name;
  const stars = (n) => '★'.repeat(n);

  return {
    // shop: the shop object from src/game/shop.js; show: whether the shop is open.
    render(shop, show) {
      enabled = show;
      panel.hidden = !show;
      const s = shop.state;
      occupied = s.board;
      for (const g of glows) {
        const taken = s.board.some((u) => u.row === g.userData.row && u.col === g.userData.col);
        g.visible = show && !!s.held;
        g.material = taken ? swapMat : glowMat;
      }
      if (!show) return;
      goldEl.textContent = `${s.gold} gold`;
      rerollBtn.textContent = `Reroll · ${tuning.economy.rerollCost}`;
      rerollBtn.disabled = s.gold < tuning.economy.rerollCost;
      const owned = [...s.board, s.held].filter(Boolean);
      cards.forEach((b, slot) => {
        const unit = s.offers[slot];
        if (!unit) {
          b.className = 'offer sold';
          b.innerHTML = '<span class="name">Sold</span>';
          b.disabled = true;
          return;
        }
        const u = tuning.units[unit];
        const merges = owned.some((o) => o.unit === unit && o.star === 1);
        b.className = `offer unit-${unit}`;
        b.innerHTML = `<span class="name">${u.name}</span><span class="role">${u.role}</span><span class="cost">${u.cost} gold</span>${merges ? '<span class="merge">makes ★★</span>' : ''}`;
        b.disabled = !shop.canBuy(slot).ok;
      });
      if (s.lastMerge) hintEl.textContent = `${name(s.lastMerge.unit)} merged into a ${stars(2)}!`;
      else if (s.held) hintEl.textContent = `Place your ${name(s.held.unit)}${s.held.star === 2 ? ' ' + stars(2) : ''}: tap a glowing cell`;
      else if (s.board.length) hintEl.textContent = 'Tap a unit to move it';
      else hintEl.textContent = 'Buy a unit';
    },

    // Where to tap a cell on your half, in CSS pixels (for the check): its
    // centre, or else the nearest visible part of it when a mini standing in
    // front hides the centre (a tap on a mini's body picks that mini).
    cellToScreen(row, col) {
      const r = canvas.getBoundingClientRect();
      const c = cellToWorld(col, globalRow('player', row));
      const toScreen = (dx, dz) => {
        const p = new THREE.Vector3(c.x + dx * CELL, c.y, c.z + dz * CELL).project(camera);
        return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
      };
      for (const d of [0, 0.2, 0.4]) {
        for (const [dx, dz] of [[0, 0], [0, -d], [-d, -d], [d, -d], [-d, 0], [d, 0], [0, d]]) {
          const s = toScreen(dx, dz);
          const hit = cellAt(s.x, s.y);
          if (hit && hit.row === row && hit.col === col) return s;
        }
      }
      return toScreen(0, 0);
    },
  };
}
