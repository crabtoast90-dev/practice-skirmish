// A simple, sensible player for headless runs (the check and npm run sim).
// Pure: it only calls shop actions, so the same run seed gives the same moves.
//
// Each shop phase it buys merges first, then anything it can afford; rerolls
// while it has gold for a reroll plus a unit; puts tanks and bruisers in front
// and ranged units at the back.
// style 'greedy' plays like that every round; 'stingy' buys one unit in round 1
// and never again (it should lose).
const RANGED = new Set(['mage', 'ranger']);
const COL_ORDER = [2, 1, 3, 0, 4];

function placeFor(shop, unit) {
  const rows = RANGED.has(unit) ? [2, 1, 0] : [0, 1, 2];
  const taken = (row, col) => shop.state.board.some((u) => u.row === row && u.col === col);
  for (const row of rows) for (const col of COL_ORDER) if (!taken(row, col)) return { row, col };
  return null;
}

// Plays one shop phase on `shop` and returns the actions it took, in order:
// { type: 'buy', slot } | { type: 'reroll' } | { type: 'tap', row, col }.
export function botShop(tuning, shop, { style = 'greedy' } = {}) {
  const actions = [];
  const s = shop.state;
  if (style === 'stingy' && (s.board.length || s.held)) return actions;
  const cheapest = Math.min(...Object.values(tuning.units).map((u) => u.cost));
  for (let guard = 0; guard < 50; guard++) {
    const owned = s.board.filter((u) => u.star === 1).map((u) => u.unit);
    const slots = s.offers.map((u, slot) => ({ u, slot })).filter(({ slot }) => shop.canBuy(slot).ok);
    const pick = slots.find(({ u }) => owned.includes(u)) ?? slots[0];
    if (pick) {
      shop.buy(pick.slot);
      actions.push({ type: 'buy', slot: pick.slot });
      if (s.held) {
        const cell = placeFor(shop, s.held.unit);
        shop.tap(cell.row, cell.col);
        actions.push({ type: 'tap', ...cell });
      }
      if (style === 'stingy') break;
      continue;
    }
    if (style === 'greedy' && s.gold >= tuning.economy.rerollCost + cheapest && s.board.length < 15) {
      shop.reroll();
      actions.push({ type: 'reroll' });
      continue;
    }
    break;
  }
  return actions;
}
