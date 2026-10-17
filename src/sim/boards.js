// "Reasonable player boards" for npm run sim. Pure and seeded: the same seed
// always gives the same boards.
//
// Each board is what a sensible player could field by a round, shopping with
// the real shop (src/game/shop.js), so gold, offers and odds all come from
// tuning. The player buys a merge whenever one shows up (two copies make a
// 2-star), otherwise buys an affordable offer, sometimes rerolls instead, and
// spends down its gold every round. Then it lines up: tanks and bruisers in
// front, the Rogue in the middle, ranged at the back.
import { makeRng, COLS } from './battle.js';
import { createShop } from '../game/shop.js';

const POLICY_SALT = 0xb0a7d5; // keeps the player's choices independent of the shop's rolls

// Preferred rows (local, 0 = front) per role; later entries are overflow.
const ROWS_FOR = {
  knight: [0, 1, 2],
  barbarian: [0, 1, 2],
  rogue: [1, 0, 2],
  mage: [2, 1, 0],
  ranger: [2, 1, 0],
};
// Tanks first so they get the middle of the front row.
const PLACE_ORDER = ['knight', 'barbarian', 'rogue', 'ranger', 'mage'];

function shopPhase(tuning, shop, rng, knobs) {
  const s = shop.state;
  const eco = tuning.economy;
  const cheapest = Math.min(...Object.values(tuning.units).map((u) => u.cost));
  const maxRerolls = Math.floor(rng() * (knobs.maxRerollsPerRound + 1));
  let rerolls = 0;
  for (let guard = 0; guard < 60; guard++) {
    const owned = [...s.board, s.held].filter((u) => u && u.star === 1).map((u) => u.unit);
    const buyable = s.offers.map((u, slot) => ({ u, slot })).filter(({ slot }) => shop.canBuy(slot).ok);
    const merge = buyable.find(({ u }) => owned.includes(u));
    const canReroll = rerolls < maxRerolls && s.gold >= eco.rerollCost + cheapest;
    if (merge) {
      shop.buy(merge.slot);
    } else if (buyable.length && !(canReroll && rng() < knobs.rerollChance)) {
      shop.buy(buyable[Math.floor(rng() * buyable.length)].slot);
    } else if (canReroll) {
      shop.reroll();
      rerolls += 1;
    } else {
      break;
    }
  }
  shop.commit();
}

// Line the bought units up: each takes a free cell in its preferred row,
// columns shuffled (middle a little more likely) so boards vary.
function lineUp(units, rng) {
  const taken = new Set();
  const out = [];
  const sorted = [...units].sort((a, b) => PLACE_ORDER.indexOf(a.unit) - PLACE_ORDER.indexOf(b.unit) || b.star - a.star);
  for (const u of sorted) {
    for (const row of ROWS_FOR[u.unit] ?? [0, 1, 2]) {
      const cols = [];
      for (let col = 0; col < COLS; col++) if (!taken.has(row * COLS + col)) cols.push({ col, key: rng() + Math.abs(col - 2) * 0.3 });
      if (!cols.length) continue;
      cols.sort((a, b) => a.key - b.key);
      taken.add(row * COLS + cols[0].col);
      out.push({ unit: u.unit, star: u.star, row, col: cols[0].col });
      break;
    }
  }
  return out;
}

/**
 * One sensible player shopping through every round. Returns one board per
 * round: [{ round, board, gold, spent }], where board is [{ unit, star, row, col }]
 * and gold is what was left unspent.
 */
export function playerProgression(tuning, seed, knobs = tuning.targets.boardGen) {
  const rng = makeRng((seed ^ POLICY_SALT) >>> 0);
  const shop = createShop(tuning, seed);
  const out = [];
  let earned = tuning.economy.startingGold;
  for (let round = 1; round <= tuning.rounds.length; round++) {
    if (round > 1) shop.startRound(round);
    earned += tuning.economy.incomePerRound[round - 1];
    shopPhase(tuning, shop, rng, knobs);
    out.push({ round, board: lineUp(shop.state.board, rng), gold: shop.state.gold, spent: earned - shop.state.gold });
  }
  return out;
}

/** count progressions, regrouped as boards[round - 1] = [board, ...]. */
export function reasonableBoards(tuning, count, { seed = 1, knobs = tuning.targets.boardGen } = {}) {
  const byRound = tuning.rounds.map(() => []);
  for (let i = 0; i < count; i++) {
    for (const b of playerProgression(tuning, seed + i, knobs)) byRound[b.round - 1].push(b);
  }
  return byRound;
}
