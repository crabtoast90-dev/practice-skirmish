// Pure, deterministic battle simulation. No three.js, no DOM, no Math.random:
// same tuning + boards + seed always gives the same result. The 3D view only
// plays back what this returns; `npm run sim` runs it headlessly in Node.

// Board: 5 columns (x 0-4) by 6 rows (y 0-5). The player owns rows 0-2 (row 2 is
// their front), the enemy owns rows 3-5 (row 3 is their front).
export const COLS = 5;
export const ROWS_PER_SIDE = 3;
export const ROWS = ROWS_PER_SIDE * 2;

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
    // Movement is cell to cell. cell = the cell it stands on (or is leaving);
    // next = the cell it is stepping into (null when standing); goal = where it's headed.
    cell: { x: entry.col, y: globalRow(side, entry.row) },
    next: null,
    goal: null,
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
const cellIndex = (x, y) => y * COLS + x;
const CELLS = COLS * ROWS;
const STEPS = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Enemies, nearest first (ties keep the lower id).
function enemiesByDistance(f, fighters) {
  return fighters
    .filter((o) => o.alive && o.side !== f.side)
    .map((o) => ({ o, d: dist(f, o) }))
    .sort((a, b) => a.d - b.d || a.o.id - b.o.id)
    .map((e) => e.o);
}

const nearestEnemy = (f, fighters) => enemiesByDistance(f, fighters)[0] ?? null;

// Cells nobody else stands on or is stepping into, and cells other fighters are headed for.
function occupancy(f, fighters) {
  const blocked = new Array(CELLS).fill(false);
  const claimed = new Array(CELLS).fill(false);
  for (const o of fighters) {
    if (!o.alive || o === f) continue;
    blocked[cellIndex(o.cell.x, o.cell.y)] = true;
    if (o.next) blocked[cellIndex(o.next.x, o.next.y)] = true;
    if (o.goal) claimed[cellIndex(o.goal.x, o.goal.y)] = true;
  }
  return { blocked, claimed };
}

// Shortest walking distance from f's cell to every free cell, going around anyone
// in the way (diagonal steps may not cut past an occupied corner, so two minis can
// never cross paths). Returns { cost, first } where first is the first step there.
function walkCosts(f, blocked) {
  const cost = new Array(CELLS).fill(Infinity);
  const first = new Array(CELLS).fill(-1);
  const done = new Array(CELLS).fill(false);
  const start = cellIndex(f.cell.x, f.cell.y);
  cost[start] = 0;
  for (;;) {
    let cur = -1;
    for (let i = 0; i < CELLS; i++) if (!done[i] && cost[i] < Infinity && (cur < 0 || cost[i] < cost[cur] - 1e-9)) cur = i;
    if (cur < 0) break;
    done[cur] = true;
    const cx = cur % COLS;
    const cy = (cur - cx) / COLS;
    for (const [dx, dy] of STEPS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const ni = cellIndex(nx, ny);
      if (blocked[ni] || done[ni]) continue;
      if (dx && dy && (blocked[cellIndex(cx + dx, cy)] || blocked[cellIndex(cx, cy + dy)])) continue;
      const c = cost[cur] + (dx && dy ? Math.SQRT2 : 1);
      if (c < cost[ni] - 1e-9) {
        cost[ni] = c;
        first[ni] = cur === start ? ni : first[cur];
      }
    }
  }
  return { cost, first, start };
}

// Where a target will be standing: the cell it's stepping into, else its cell.
const anchor = (t) => t.next ?? t.cell;

// The nearest free cell from which f can hit target (melee units fan out around the
// target because cells another fighter is headed for don't count as free).
function bestCellInReach(f, target, reach, walk, claimed) {
  const a = anchor(target);
  let best = -1;
  for (let i = 0; i < CELLS; i++) {
    if (walk.cost[i] === Infinity || (claimed[i] && i !== walk.start)) continue;
    const x = i % COLS;
    const y = (i - x) / COLS;
    if (Math.hypot(x - a.x, y - a.y) > reach + 1e-9) continue;
    if (best < 0 || walk.cost[i] < walk.cost[best] - 1e-9) best = i;
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

      const reach = f.range + c.meleeReach;

      // Mid-step: keep walking into the next cell, then decide again.
      if (f.next) {
        const d = Math.hypot(f.next.x - f.x, f.next.y - f.y);
        const step = f.moveSpeed * dt;
        if (step >= d) {
          f.x = f.next.x;
          f.y = f.next.y;
          f.cell = f.next;
          f.next = null;
        } else {
          f.x += ((f.next.x - f.x) / d) * step;
          f.y += ((f.next.y - f.y) / d) * step;
        }
        continue;
      }

      // Standing on a cell. Keep a target that's in reach; otherwise take the nearest enemy.
      if (!f.target || !f.target.alive || dist(f, f.target) > reach) f.target = nearestEnemy(f, fighters);
      const target = f.target;
      if (!target) continue;
      if (dist(f, target) > reach) {
        // Head for the nearest free cell in reach of the target. If every cell
        // around it is taken or cut off, go for the next-nearest enemy instead.
        const { blocked, claimed } = occupancy(f, fighters);
        const walk = walkCosts(f, blocked);
        let goal = -1;
        for (const e of enemiesByDistance(f, fighters)) {
          goal = bestCellInReach(f, e, reach, walk, claimed);
          if (goal >= 0) { f.target = e; break; }
        }
        if (goal < 0 || goal === walk.start) {
          // Nowhere to go (or already standing in the right spot, waiting for the target to arrive).
          f.goal = goal === walk.start ? f.cell : null;
          continue;
        }
        const gx = goal % COLS;
        f.goal = { x: gx, y: (goal - gx) / COLS };
        const n = walk.first[goal];
        const nx = n % COLS;
        f.next = { x: nx, y: (n - nx) / COLS };
        continue;
      }
      f.goal = f.cell;
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
