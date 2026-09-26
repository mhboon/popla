export interface CourtAssignment {
  round: number;
  court: number;
  team1PlayerIds: [string, string];
  team2PlayerIds: [string, string];
}

// Enough of a Match to rank/track partnerships from — matches both the
// DynamoDB item shape (generate-round/index.ts) and the simulator's
// in-memory shape (infra/scripts/simulate-pairing.ts).
export interface MatchRecord {
  round: number;
  team1PlayerIds: string[];
  team2PlayerIds: string[];
  team1Games: number;
  team2Games: number;
  status: string;
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

export function partnershipKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

// Which matchday-so-far partnerships a bucket's 2v2 split should weigh
// against — split into "the immediately previous round" (avoided as a
// hard rule, since a bucket of 4 can never have all 3 possible splits
// collide with it — see generate-round/index.ts) and "any round before
// that" (avoided only as a soft preference, since further back there's
// no guarantee a repeat-free split exists).
export interface PartnershipHistory {
  previousRound: Set<string>;
  earlier: Set<string>;
}

export function buildPartnershipHistory(
  priorMatches: MatchRecord[],
  round: number
): PartnershipHistory {
  const previousRound = new Set<string>();
  const earlier = new Set<string>();
  for (const match of priorMatches) {
    const target =
      match.round === round - 1 ? previousRound : match.round < round - 1 ? earlier : null;
    if (!target) continue; // match.round >= round shouldn't happen — defensive, not an error case
    target.add(partnershipKey(match.team1PlayerIds[0], match.team1PlayerIds[1]));
    target.add(partnershipKey(match.team2PlayerIds[0], match.team2PlayerIds[1]));
  }
  return { previousRound, earlier };
}

interface Split {
  team1: [string, string];
  team2: [string, string];
}

// The 3 ways to split 4 (already-shuffled) players into two teams of 2.
function possibleSplits(group: [string, string, string, string]): Split[] {
  const [a, b, c, d] = group;
  return [
    { team1: [a, b], team2: [c, d] },
    { team1: [a, c], team2: [b, d] },
    { team1: [a, d], team2: [b, c] },
  ];
}

// Picks the 2v2 split for one already-shuffled group of 4 — see SPEC.md's
// Match Generation:
// 1. Hard rule: never repeat the immediately previous round's pairing.
//    Each of the 4 players has at most one partner from that round, so at
//    most one of the 3 splits can ever collide with it — at least 2
//    splits always survive this filter, so this never needs a fallback.
// 2. Soft rule: among the survivors, prefer whichever has the fewest
//    pairs that already played together in some earlier round. Ties
//    (commonly 0 vs 0) are broken randomly.
function pickSplit(group: [string, string, string, string], history: PartnershipHistory): Split {
  const splits = possibleSplits(group);
  const repeatsPreviousRound = (s: Split) =>
    history.previousRound.has(partnershipKey(...s.team1)) ||
    history.previousRound.has(partnershipKey(...s.team2));
  const candidates = splits.filter((s) => !repeatsPreviousRound(s));
  // Falls back to all 3 splits only if the hard rule above ever somehow
  // eliminates every option (shouldn't happen — see comment above).
  const pool = candidates.length > 0 ? candidates : splits;

  const earlierRepeatCount = (s: Split) =>
    (history.earlier.has(partnershipKey(...s.team1)) ? 1 : 0) +
    (history.earlier.has(partnershipKey(...s.team2)) ? 1 : 0);
  const minRepeats = Math.min(...pool.map(earlierRepeatCount));
  const best = pool.filter((s) => earlierRepeatCount(s) === minRepeats);

  return best[Math.floor(Math.random() * best.length)];
}

/**
 * Buckets an already-ordered list of player IDs into groups of 4 (in
 * order), one court per group, and picks the 2-vs-2 team split within
 * each group, weighed against `history` — see pickSplit above. Used for
 * Mexicano: players are ordered by current standings (or randomly for
 * round 1), and the avoidance is deliberately scoped to whichever 4
 * happen to land in a bucket together — bucket composition there is
 * meaningful (it's the standings-based ranking), so avoidance shouldn't
 * reach outside it. See courtsFromGlobalRandomPairing below for
 * Americano, whose groupings carry no such meaning.
 */
export function courtsFromOrderedPlayers(
  round: number,
  orderedPlayerIds: string[],
  history: PartnershipHistory
): CourtAssignment[] {
  if (orderedPlayerIds.length === 0 || orderedPlayerIds.length % 4 !== 0) {
    throw new Error('participant count must be a non-zero multiple of 4');
  }

  const courts: CourtAssignment[] = [];
  for (let i = 0; i < orderedPlayerIds.length; i += 4) {
    const group = shuffle(orderedPlayerIds.slice(i, i + 4)) as [string, string, string, string];
    const { team1, team2 } = pickSplit(group, history);
    courts.push({
      round,
      court: i / 4 + 1,
      team1PlayerIds: team1,
      team2PlayerIds: team2,
    });
  }
  return courts;
}

function violatesPreviousRound(a: string, b: string, history: PartnershipHistory): boolean {
  return history.previousRound.has(partnershipKey(a, b));
}

function violatesEarlierRound(a: string, b: string, history: PartnershipHistory): boolean {
  return history.earlier.has(partnershipKey(a, b));
}

// One random pass at pairing up the whole field: each player (processed
// in random order) picks a random still-unpaired partner, preferring one
// that doesn't repeat the previous round, then preferring one that
// doesn't repeat any earlier round either — same hard/soft rule as
// pickSplit, just applied across all N players at once instead of one
// bucket of 4. Unlike a bucket of 4, there's no guarantee a single greedy
// pass avoids every previous-round repeat (an unlucky early pick can
// leave two ex-partners as the only players left for each other) — see
// buildGlobalPartnerships below, which retries this and keeps the best.
function greedyGlobalPartnerships(
  playerIds: string[],
  history: PartnershipHistory
): [string, string][] {
  const remaining = shuffle(playerIds);
  const partnerships: [string, string][] = [];

  while (remaining.length > 0) {
    const player = remaining.shift()!;
    const withoutPreviousRound = remaining.filter((c) => !violatesPreviousRound(player, c, history));
    const pool = withoutPreviousRound.length > 0 ? withoutPreviousRound : remaining;
    const withoutEarlier = pool.filter((c) => !violatesEarlierRound(player, c, history));
    const finalPool = withoutEarlier.length > 0 ? withoutEarlier : pool;

    const partner = finalPool[Math.floor(Math.random() * finalPool.length)];
    partnerships.push([player, partner]);
    remaining.splice(remaining.indexOf(partner), 1);
  }

  return partnerships;
}

function countViolations(
  partnerships: [string, string][],
  history: PartnershipHistory
): { previousRound: number; earlier: number } {
  let previousRoundCount = 0;
  let earlierCount = 0;
  for (const [a, b] of partnerships) {
    if (violatesPreviousRound(a, b, history)) previousRoundCount++;
    else if (violatesEarlierRound(a, b, history)) earlierCount++;
  }
  return { previousRound: previousRoundCount, earlier: earlierCount };
}

// Bounded retries rather than a guarantee: a repeat-free (or best-
// possible) pairing across the whole field always exists in theory (the
// classic round-robin-scheduling result: a complete graph minus a
// perfect matching always has a perfect matching of its own), but
// finding one isn't as trivial as the 3-way enumeration a bucket of 4
// allows. Retrying a cheap random greedy pass a bounded number of times
// and keeping the best is simple and, in practice, reliably finds a
// clean pairing well within this budget for realistic field sizes.
const GLOBAL_PAIRING_ATTEMPTS = 25;

function buildGlobalPartnerships(
  playerIds: string[],
  history: PartnershipHistory
): [string, string][] {
  let best = greedyGlobalPartnerships(playerIds, history);
  let bestScore = countViolations(best, history);

  for (let attempt = 1; attempt < GLOBAL_PAIRING_ATTEMPTS; attempt++) {
    if (bestScore.previousRound === 0 && bestScore.earlier === 0) break;
    const candidate = greedyGlobalPartnerships(playerIds, history);
    const score = countViolations(candidate, history);
    if (
      score.previousRound < bestScore.previousRound ||
      (score.previousRound === bestScore.previousRound && score.earlier < bestScore.earlier)
    ) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

/**
 * Americano: pairs up the whole field at once (see buildGlobalPartnerships),
 * then randomly groups the resulting partnerships two at a time into
 * courts — which partnerships end up facing which others is arbitrary
 * (opponent repeats are never tracked, only partnerships, per SPEC.md).
 */
export function courtsFromGlobalRandomPairing(
  round: number,
  playerIds: string[],
  history: PartnershipHistory
): CourtAssignment[] {
  if (playerIds.length === 0 || playerIds.length % 4 !== 0) {
    throw new Error('participant count must be a non-zero multiple of 4');
  }

  const partnerships = shuffle(buildGlobalPartnerships(playerIds, history));

  const courts: CourtAssignment[] = [];
  for (let i = 0; i < partnerships.length; i += 2) {
    courts.push({
      round,
      court: i / 2 + 1,
      team1PlayerIds: partnerships[i],
      team2PlayerIds: partnerships[i + 1],
    });
  }
  return courts;
}

export interface PlayerStanding {
  gamesWon: number;
  gamesLost: number;
  gameDiff: number;
  setsWon: number;
}

// Standings accumulated so far *this matchday* (games won, then game
// differential, then sets won — see SPEC.md's Day Ranking), derived from
// completed matches rather than read from a persisted table — see
// rankByStandingsSoFar below for why.
export function computeStandings(
  priorMatches: MatchRecord[],
  participantIds: string[]
): Map<string, PlayerStanding> {
  const standings = new Map<string, PlayerStanding>();
  for (const playerId of participantIds) {
    standings.set(playerId, { gamesWon: 0, gamesLost: 0, gameDiff: 0, setsWon: 0 });
  }

  for (const match of priorMatches) {
    if (match.status !== 'COMPLETE') continue;
    const t1 = match.team1Games;
    const t2 = match.team2Games;
    const team1Won = t1 > t2;

    for (const playerId of match.team1PlayerIds) {
      const s = standings.get(playerId);
      if (!s) continue;
      s.setsWon += team1Won ? 1 : 0;
      s.gamesWon += t1;
      s.gamesLost += t2;
      s.gameDiff += t1 - t2;
    }
    for (const playerId of match.team2PlayerIds) {
      const s = standings.get(playerId);
      if (!s) continue;
      s.setsWon += team1Won ? 0 : 1;
      s.gamesWon += t2;
      s.gamesLost += t1;
      s.gameDiff += t2 - t1;
    }
  }

  return standings;
}

/**
 * Mexicano rounds after the first: rank players by the standings
 * accumulated so far *this matchday*, derived from the completed matches
 * of prior rounds. This is deliberately not read from a persisted table —
 * MatchdayResults only exists once the matchday is closed, so the interim
 * ranking is recomputed each time a round is generated. Ties are broken
 * by shuffling before the stable sort, so equal standings land in random
 * relative order each time.
 */
export function rankByStandingsSoFar(
  priorMatches: MatchRecord[],
  participantIds: string[]
): string[] {
  const standings = computeStandings(priorMatches, participantIds);
  return randomOrder(participantIds).sort((a, b) => {
    const sa = standings.get(a)!;
    const sb = standings.get(b)!;
    if (sb.gamesWon !== sa.gamesWon) return sb.gamesWon - sa.gamesWon;
    if (sb.gameDiff !== sa.gameDiff) return sb.gameDiff - sa.gameDiff;
    return sb.setsWon - sa.setsWon;
  });
}
