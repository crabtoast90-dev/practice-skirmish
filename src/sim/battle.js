// Pure, deterministic battle simulation. No three.js, no DOM, no Math.random:
// same tuning + boards + seed always gives the same result. The 3D view only
// plays back what this returns; `npm run sim` runs it headlessly in Node.

// Board: 5 columns (x 0-4) by 6 rows (y 0-5). The player owns rows 0-2 (row 2 is
// their front), the enemy owns rows 3-5 (row 3 is their front).
export const COLS = 5;
export const ROWS_PER_SIDE = 3;

// Seeded random numbers (mulberry32).
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A side's local row (0 = front, 2 = back) to the board's global row.
export function globalRow(side, row) {
  return side === 'player' ? ROWS_PER_SIDE - 1 - row : ROWS_PER_SIDE + row;
}

function statsFor(tuning, unit) {
  const base = tuning.units[unit] ?? tuning.enemies[unit];
  if (!base) throw new Error(`unknown unit "${unit}" (not in tuning.units or tuning.enemies)`);
  return base;
}

function makeFighter(tuning, side, entry, id, rng) {
  const base = statsFor(tuning, entry.unit);
  const star = entry.star ?? 1;
  const hpMul = star === 2 ? tuning.star2.hp : 1;
  const dmgMul = star === 2 ? tuning.star2.damage : 1;
  const sp = base.special;
  return {
    id,
    side,
    unit: entry.unit,
    star,
    x: entry.col,
    y: globalRow(side, entry.row),
    maxHp: base.hp * hpMul,
    hp: base.hp * hpMul,
    damage: base.damage * dmgMul,
    attackInterval: 1 / base.attackSpeed,
    range: base.range,
    moveSpeed: base.moveSpeed,
    special: sp,
    specialTimer: sp.built ? (sp.firstAt ?? 1) * sp.cooldown : Infinity,
    attackTimer: rng() / base.attackSpeed, // stagger first swings so mirror fights aren't locked
    shieldUntil: -1, // Shield Wall
    empowered: false, // Heavy Blow: next attack hits harder
    target: null,
    alive: true,
    damageDealt: 0,
  };
}

const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

function nearestEnemy(f, fighters) {
  let best = null;
  let bestD = Infinity;
  for (const o of fighters) {
    if (!o.alive || o.side === f.side) continue;
    const d = dist(f, o);
    if (d < bestD - 1e-9) { best = o; bestD = d; } // ties keep the lower id
  }
  return best;
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Run one battle.
 * playerBoard / enemyBoard: [{ unit, row, col, star? }] in each side's local rows.
 * Returns { winner: 'player'|'enemy'|'draw', duration, timedOut, units, events, frames, survivors }.
 * frames: one snapshot per tick, [[x, y, hp], ...] in units order (for playback).
 */
export function simulate(tuning, playerBoard, enemyBoard, seed, { record = true } = {}) {
  const rng = makeRng(seed);
  const c = tuning.combat;
  const dt = 1 / c.ticksPerSecond;
  const maxTicks = Math.round(c.timeoutSeconds * c.ticksPerSecond);
  const fighters = [];
  for (const e of playerBoard) fighters.push(makeFighter(tuning, 'player', e, fighters.length, rng));
  for (const e of enemyBoard) fighters.push(makeFighter(tuning, 'enemy', e, fighters.length, rng));

  const events = [];
  const frames = [];
  const log = (ev) => record && events.push(ev);
  const snapshot = () => record && frames.push(fighters.map((f) => [round3(f.x), round3(f.y), Math.max(0, Math.round(f.hp))]));

  function hit(attacker, target, amount, t) {
    let dmg = amount * (1 + (rng() * 2 - 1) * c.damageVariance);
    if (target.shieldUntil > t) dmg *= target.special.damageTaken;
    dmg = Math.round(dmg);
    target.hp -= dmg;
    attacker.damageDealt += dmg;
    log({ t: round3(t), type: 'hit', from: attacker.id, to: target.id, amount: dmg });
    if (target.hp <= 0 && target.alive) {
      target.alive = false;
      log({ t: round3(t), type: 'death', id: target.id });
    }
  }

  const sideAlive = (side) => fighters.some((f) => f.alive && f.side === side);
  snapshot();
  let tick = 0;
  while (tick < maxTicks && sideAlive('player') && sideAlive('enemy')) {
    tick += 1;
    const t = tick * dt;
    for (const f of fighters) {
      if (!f.alive) continue;

      // Special on its cooldown.
      f.specialTimer -= dt;
      if (f.specialTimer <= 0) {
        f.specialTimer += f.special.cooldown;
        if (f.special.kind === 'shieldWall') f.shieldUntil = t + f.special.duration;
        if (f.special.kind === 'heavyBlow') f.empowered = true;
        log({ t: round3(t), type: 'special', id: f.id, name: f.special.name });
      }

      if (!f.target || !f.target.alive) f.target = nearestEnemy(f, fighters);
      const target = f.target;
      if (!target) continue;
      const d = dist(f, target);
      const reach = f.range + c.meleeReach;
      if (d > reach) {
        // Walk straight at the target, stopping just inside reach.
        const step = Math.min(f.moveSpeed * dt, d - reach + 0.01);
        f.x += ((target.x - f.x) / d) * step;
        f.y += ((target.y - f.y) / d) * step;
        continue;
      }
      f.attackTimer -= dt;
      if (f.attackTimer <= 0) {
        f.attackTimer += f.attackInterval;
        let amount = f.damage;
        if (f.empowered) { amount *= f.special.multiplier; f.empowered = false; }
        log({ t: round3(t), type: 'attack', id: f.id, to: target.id });
        hit(f, target, amount, t);
      }
    }
    snapshot();
  }

  const p = sideAlive('player');
  const e = sideAlive('enemy');
  const timedOut = p && e;
  return {
    winner: timedOut ? 'draw' : p ? 'player' : 'enemy',
    duration: round3(tick * dt),
    timedOut,
    dt,
    units: fighters.map((f) => ({ id: f.id, side: f.side, unit: f.unit, star: f.star, maxHp: f.maxHp, damageDealt: f.damageDealt })),
    survivors: fighters.filter((f) => f.alive).map((f) => ({ id: f.id, unit: f.unit, hp: Math.round(f.hp) })),
    events,
    frames,
  };
}
