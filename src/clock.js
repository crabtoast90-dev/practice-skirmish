// Game clock. Real time in normal play; in test mode (?test) time only moves
// when the check script calls advance(), so every run repeats exactly.
export const STEP = 1 / 60;

export function createClock({ manual }) {
  return {
    manual,
    time: 0,
    frame: 0,
    tick(dt) {
      this.time += dt;
      this.frame += 1;
    },
  };
}
