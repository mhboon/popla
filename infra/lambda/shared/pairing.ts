export interface CourtAssignment {
  round: number;
  court: number;
  team1PlayerIds: [string, string];
  team2PlayerIds: [string, string];
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randomOrder(playerIds: string[]): string[] {
  return shuffle(playerIds);
}

/**
 * Buckets an already-ordered list of player IDs into groups of 4 (in
 * order), one court per group, and randomizes the 2-vs-2 team split
 * within each group. Used for both formats:
 *  - Mexicano: pass players ordered by current standings (or randomly for
 *    round 1).
 *  - Americano: pass a freshly randomized order every round.
 */
export function courtsFromOrderedPlayers(
  round: number,
  orderedPlayerIds: string[]
): CourtAssignment[] {
  if (orderedPlayerIds.length === 0 || orderedPlayerIds.length % 4 !== 0) {
    throw new Error('participant count must be a non-zero multiple of 4');
  }

  const courts: CourtAssignment[] = [];
  for (let i = 0; i < orderedPlayerIds.length; i += 4) {
    const group = shuffle(orderedPlayerIds.slice(i, i + 4));
    courts.push({
      round,
      court: i / 4 + 1,
      team1PlayerIds: [group[0], group[1]],
      team2PlayerIds: [group[2], group[3]],
    });
  }
  return courts;
}
