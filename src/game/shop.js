// Pure shop and placement rules. No three.js, no DOM, no Math.random: the same
// seed and the same taps always give the same offers and board, so the sim can
// reuse it to build "reasonable player boards".
import { makeRng, COLS, ROWS_PER_SIDE } from '../sim/battle.js';

const SHOP_SALT = 0x5eed5; // keeps shop rolls independent of the fight's random numbers

// One offer slot, weighted by economy.shopOdds for this round (1-based).
export function rollUnit(tuning, round, rng) {
  const odds = Object.entries(tuning.economy.shopOdds).map(([unit, w]) => [unit, w[Math.min(round, w.length) - 1]]);
  const total = odds.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [unit, w] of odds) {
    r -= w;
    if (r < 0) return unit;
  }
  return odds[odds.length - 1][0];
}

export function rollOffers(tuning, round, rng) {
  return Array.from({ length: tuning.economy.offersPerRound }, () => rollUnit(tuning, round, rng));
}

/**
 * A shop for one sitting. board: [{ id, unit, star, row, col }] in local rows
 * (0 = front). held: the unit in your hand waiting to be placed, or null.
 * Every action returns { ok, reason? } and never throws on a bad tap.
 */
export function createShop(tuning, seed, { round = 1 } = {}) {
  const rng = makeRng((seed ^ SHOP_SALT) >>> 0);
  const eco = tuning.economy;
  let nextId = 1;
  const s = {
    round,
    gold: eco.startingGold + eco.incomePerRound[round - 1],
    offers: rollOffers(tuning, round, rng), // unit keys; null = bought
    board: [],
    held: null,
    lastMerge: null, // { unit, id } of the most recent 2-star merge
  };

  const at = (row, col) => s.board.find((u) => u.row === row && u.col === col);
  const inHalf = (row, col) => Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < ROWS_PER_SIDE && col >= 0 && col < COLS;
  const freeCells = () => {
    const out = [];
    for (let row = 0; row < ROWS_PER_SIDE; row++) for (let col = 0; col < COLS; col++) if (!at(row, col)) out.push({ row, col });
    return out;
  };
  // Front row first, middle columns first: where a sensible player drops a unit.
  const firstFree = () => freeCells().sort((a, b) => a.row - b.row || Math.abs(a.col - 2) - Math.abs(b.col - 2) || a.col - b.col)[0];

  function dropHeld() {
    if (!s.held) return;
    const cell = firstFree();
    s.board.push({ ...s.held, ...cell });
    s.held = null;
  }

  return {
    state: s,
    cost: (unit) => tuning.units[unit].cost,

    canBuy(slot) {
      const unit = s.offers[slot];
      if (!unit) return { ok: false, reason: 'sold' };
      if (s.gold < tuning.units[unit].cost) return { ok: false, reason: 'gold' };
      const merges = [...s.board, s.held].some((u) => u && u.unit === unit && u.star === 1);
      if (!merges && freeCells().length - (s.held ? 1 : 0) <= 0) return { ok: false, reason: 'full' };
      return { ok: true };
    },

    // Buy an offer. A second copy of a 1-star merges straight into a 2-star
    // (on the board or in your hand); anything else goes into your hand, and a
    // unit already in your hand drops onto the first free cell.
    buy(slot) {
      const check = this.canBuy(slot);
      if (!check.ok) return check;
      const unit = s.offers[slot];
      s.gold -= tuning.units[unit].cost;
      s.offers[slot] = null;
      const twin = (s.held && s.held.unit === unit && s.held.star === 1 ? s.held : null) ?? s.board.find((u) => u.unit === unit && u.star === 1);
      if (twin) {
        twin.star = 2;
        s.lastMerge = { unit, id: twin.id };
        return { ok: true, merged: true, id: twin.id };
      }
      dropHeld();
      s.held = { id: nextId++, unit, star: 1 };
      s.lastMerge = null;
      return { ok: true, merged: false, id: s.held.id };
    },

    reroll() {
      if (s.gold < eco.rerollCost) return { ok: false, reason: 'gold' };
      s.gold -= eco.rerollCost;
      s.lastMerge = null;
      s.offers = rollOffers(tuning, s.round, rng);
      return { ok: true };
    },

    // Tap a cell on your half. Holding a unit: place it (swapping with whoever
    // stands there). Empty hand: pick up the unit on that cell.
    tap(row, col) {
      if (!inHalf(row, col)) return { ok: false, reason: 'outside' };
      s.lastMerge = null;
      const there = at(row, col);
      if (s.held) {
        const placing = s.held;
        s.held = null;
        if (there) {
          s.board.splice(s.board.indexOf(there), 1);
          s.held = { id: there.id, unit: there.unit, star: there.star };
        }
        s.board.push({ ...placing, row, col });
        return { ok: true, placed: placing.id };
      }
      if (!there) return { ok: false, reason: 'empty' };
      s.board.splice(s.board.indexOf(there), 1);
      s.held = { id: there.id, unit: there.unit, star: there.star };
      return { ok: true, picked: there.id };
    },

    // Before a fight: whatever is in your hand goes onto the board.
    commit() {
      dropHeld();
      return s.board.map(({ unit, star, row, col }) => ({ unit, star, row, col }));
    },

    // Test hook: replace the board with these units ([{ unit, row, col, star? }]) and empty your hand.
    setBoard(entries) {
      s.board = entries.map((e) => ({ id: nextId++, unit: e.unit, star: e.star ?? 1, row: e.row, col: e.col }));
      s.held = null;
      s.lastMerge = null;
    },

    // A new shop phase: this round's income on top of saved gold, and a fresh
    // roll. The board carries over.
    startRound(round) {
      s.round = round;
      s.gold += eco.incomePerRound[round - 1];
      s.offers = rollOffers(tuning, round, rng);
      s.lastMerge = null;
    },
  };
}
