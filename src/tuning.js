// ALL tuning numbers for Diorama Skirmish live in this one file.
// Ask for changes by name, e.g. "Knight hp to 1000" or "round 3 enemy board: add a Skeleton Mage".
// Units of measure: time in seconds, distance in board cells, speeds per second.
// Plain data only: the sim (headless) and the 3D view both read it.

export const TUNING = {
  // How every fight runs.
  combat: {
    ticksPerSecond: 20, // sim resolution; not a balance knob
    timeoutSeconds: 40, // a fight still going after this is a draw (counts as a loss for the player)
    damageVariance: 0.1, // each hit rolls +-10% around its damage
    meleeReach: 0.5, // extra slack on range so a range-1 unit can hit diagonally adjacent cells
  },

  // Two copies of the same 1-star unit merge into a 2-star with these multipliers.
  star2: { hp: 1.8, damage: 1.8 },

  // Player units: the five KayKit Adventurers.
  // range 1 = melee. attackSpeed = attacks per second. moveSpeed = cells per second.
  // built: false = the special is defined here but not in the sim yet (see PLAN.md).
  units: {
    knight: {
      name: 'Knight', role: 'tank', cost: 2,
      hp: 900, damage: 50, attackSpeed: 0.8, range: 1, moveSpeed: 1.5,
      special: { name: 'Shield Wall', kind: 'shieldWall', built: true, cooldown: 8, duration: 3, damageTaken: 0.5 },
    },
    barbarian: {
      name: 'Barbarian', role: 'melee bruiser', cost: 2,
      hp: 750, damage: 70, attackSpeed: 0.9, range: 1, moveSpeed: 1.6,
      special: { name: 'Cleave', kind: 'cleave', built: false, cooldown: 6, multiplier: 1.5, radius: 1 },
    },
    rogue: {
      name: 'Rogue', role: 'backline diver', cost: 3,
      hp: 550, damage: 60, attackSpeed: 1.2, range: 1, moveSpeed: 2.2,
      special: { name: 'Shadow Leap', kind: 'leapBackline', built: false, cooldown: 7, firstAt: 0.5 },
    },
    mage: {
      name: 'Mage', role: 'area damage', cost: 3,
      hp: 450, damage: 40, attackSpeed: 0.7, range: 3, moveSpeed: 1.3,
      special: { name: 'Fireball', kind: 'areaBlast', built: false, cooldown: 7, damage: 160, radius: 1 },
    },
    ranger: {
      name: 'Ranger', role: 'long range', cost: 2,
      hp: 500, damage: 55, attackSpeed: 0.9, range: 4, moveSpeed: 1.4,
      special: { name: 'Piercing Arrow', kind: 'pierce', built: false, cooldown: 6, multiplier: 2 },
    },
  },

  // Enemy units: the four KayKit Skeletons. Same fields as player units (cost unused).
  enemies: {
    skeletonWarrior: {
      name: 'Skeleton Warrior', role: 'melee', cost: 0,
      hp: 750, damage: 45, attackSpeed: 0.9, range: 1, moveSpeed: 1.5,
      special: { name: 'Heavy Blow', kind: 'heavyBlow', built: true, cooldown: 6, multiplier: 2.5 },
    },
    skeletonRogue: {
      name: 'Skeleton Rogue', role: 'fast melee', cost: 0,
      hp: 450, damage: 45, attackSpeed: 1.2, range: 1, moveSpeed: 2.0,
      special: { name: 'Backstab', kind: 'heavyBlow', built: false, cooldown: 5, multiplier: 2 },
    },
    skeletonMage: {
      name: 'Skeleton Mage', role: 'ranged caster', cost: 0,
      hp: 400, damage: 40, attackSpeed: 0.7, range: 3, moveSpeed: 1.2,
      special: { name: 'Bone Burst', kind: 'areaBlast', built: false, cooldown: 8, damage: 120, radius: 1 },
    },
    skeletonMinion: {
      name: 'Skeleton Minion', role: 'fodder', cost: 0,
      hp: 300, damage: 25, attackSpeed: 1.0, range: 1, moveSpeed: 1.6,
      special: { name: 'Rattle', kind: 'none', built: false, cooldown: 99 },
    },
  },

  // Shop and economy (used once the shop is built; see PLAN.md).
  economy: {
    lives: 3,
    startingGold: 4,
    incomePerRound: [4, 5, 6, 7, 8], // gold gained at the start of rounds 1-5
    offersPerRound: 3,
    rerollCost: 1,
    // Chance weight of each unit showing in a shop slot, per round (higher = more often).
    shopOdds: {
      knight: [3, 3, 3, 3, 3],
      barbarian: [3, 3, 3, 3, 3],
      ranger: [3, 3, 3, 3, 3],
      rogue: [1, 2, 3, 3, 3],
      mage: [1, 2, 3, 3, 3],
    },
  },

  // Scripted enemy boards, rounds 1-5. row 0 = front row (nearest the middle), 2 = back. col 0-4.
  rounds: [
    { name: 'Round 1', board: [
      { unit: 'skeletonMinion', row: 0, col: 1 }, { unit: 'skeletonMinion', row: 0, col: 3 },
    ] },
    { name: 'Round 2', board: [
      { unit: 'skeletonWarrior', row: 0, col: 2 }, { unit: 'skeletonMinion', row: 0, col: 0 },
      { unit: 'skeletonMinion', row: 0, col: 4 },
    ] },
    { name: 'Round 3', board: [
      { unit: 'skeletonWarrior', row: 0, col: 1 }, { unit: 'skeletonWarrior', row: 0, col: 3 },
      { unit: 'skeletonMage', row: 2, col: 2 },
    ] },
    { name: 'Round 4', board: [
      { unit: 'skeletonWarrior', row: 0, col: 1 }, { unit: 'skeletonWarrior', row: 0, col: 3 },
      { unit: 'skeletonRogue', row: 1, col: 0 }, { unit: 'skeletonMage', row: 2, col: 2 },
    ] },
    { name: 'Round 5 (boss)', board: [
      { unit: 'skeletonWarrior', star: 2, row: 0, col: 2 }, { unit: 'skeletonWarrior', row: 0, col: 0 },
      { unit: 'skeletonWarrior', row: 0, col: 4 }, { unit: 'skeletonRogue', row: 1, col: 1 },
      { unit: 'skeletonMage', row: 2, col: 3 },
    ] },
  ],

  // Balance targets BALANCE.md checks against.
  targets: {
    fightSeconds: [10, 25],
    unitWinRate: [0.4, 0.6],
    round1ClearRate: 0.95,
    round5ClearRate: 0.33,
  },
};
