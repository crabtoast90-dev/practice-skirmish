// Pure rules for one sitting: five rounds, three lives, Victory or Defeat.
// No three.js, no DOM: the same seed and the same taps always play the same
// run, so the sim can play whole runs headlessly.
//
// Flow: shop -> fight -> result -> (next round | same round again) -> ... ->
// victory | defeat. Winning a round moves you on; losing one (a draw counts as
// a loss) costs a life and you replay that round. Clear all rounds = Victory,
// out of lives = Defeat. Every shop phase pays that round's income.
import { simulate } from '../sim/battle.js';
import { createShop } from './shop.js';

export function createRun(tuning, seed) {
  const shop = createShop(tuning, seed);
  const rounds = tuning.rounds;
  const s = {
    round: 1,
    lives: tuning.economy.lives,
    phase: 'shop', // shop | fight | result | victory | defeat
    fights: 0,
    last: null, // { round, won, winner, duration } of the latest fight
    history: [], // one entry per fight
  };

  return {
    state: s,
    shop,
    rounds: rounds.length,
    enemyBoard: () => rounds[s.round - 1].board,
    roundName: () => rounds[s.round - 1].name,

    // Lock the board in and play the round's fight. Returns the sim result
    // plus the boards and seed it used, or null if there's nothing to fight with.
    // `enemy` replaces the round's board (test hook only).
    fight({ record = true, enemy = rounds[s.round - 1].board } = {}) {
      if (s.phase !== 'shop') return null;
      const player = shop.commit();
      if (!player.length) return null;
      s.fights += 1;
      const fightSeed = seed * 1000 + s.fights; // a new seed per fight, same every replay
      const result = simulate(tuning, player, enemy, fightSeed, { record });
      const won = result.winner === 'player';
      if (!won) s.lives -= 1;
      s.last = { round: s.round, won, winner: result.winner, duration: result.duration };
      s.history.push(s.last);
      s.phase = s.lives <= 0 ? 'defeat' : won && s.round === rounds.length ? 'victory' : 'result';
      return { ...result, boards: { player, enemy }, seed: fightSeed };
    },

    // From a round result into the next shop: the next round if you won, the same one if not.
    next() {
      if (s.phase !== 'result') return false;
      if (s.last.won) s.round += 1;
      shop.startRound(s.round);
      s.phase = 'shop';
      return true;
    },
  };
}
