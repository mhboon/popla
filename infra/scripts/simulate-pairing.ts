#!/usr/bin/env -S npx tsx
// Local simulator for the Mexicano pairing algorithm — imports the exact
// same pure functions the real generateRound Lambda uses (see
// infra/lambda/shared/pairing.ts), so this tests the real logic rather
// than a reimplementation. Match results are fabricated (a random winner
// each match, see simulateScore below) purely to drive the same
// standings-based bucketing the real system uses — this isn't a skill
// model, just enough to exercise the pairing/repeat-avoidance mechanics
// round over round.
//
// Usage:
//   npx tsx infra/scripts/simulate-pairing.ts --players 16 --rounds 6
//   npx tsx infra/scripts/simulate-pairing.ts --players 16 --rounds 6 --out report.md
//
// With no --out, the report is printed to stdout (redirect with `>` to
// save it yourself).

import { writeFileSync } from 'node:fs';
import {
  buildPartnershipHistory,
  computeStandings,
  courtsFromOrderedPlayers,
  randomOrder,
  rankByStandingsSoFar,
  type MatchRecord,
  type PlayerStanding,
} from '../lambda/shared/pairing';

function parseArgs(argv: string[]): { players: number; rounds: number; out: string | null } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };

  const players = Number(get('--players') ?? get('-p'));
  const rounds = Number(get('--rounds') ?? get('-r'));
  const out = get('--out') ?? null;

  if (!Number.isInteger(players) || players <= 0 || players % 4 !== 0) {
    throw new Error('--players must be a positive multiple of 4');
  }
  if (!Number.isInteger(rounds) || rounds <= 0) {
    throw new Error('--rounds must be a positive integer');
  }

  return { players, rounds, out };
}

// Spreadsheet-style: A, B, ... Z, AA, AB, ... — "call the players by
// alphabet" for any player count, not just up to 26.
function playerLabel(index: number): string {
  let n = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

// Purely for driving standings — a coin-flip winner, winner scores 6,
// loser scores a random 0-5. No persistent skill; every match is an
// independent coin flip.
function simulateScore(): { team1Games: number; team2Games: number } {
  const team1Wins = Math.random() < 0.5;
  const loserGames = Math.floor(Math.random() * 6); // 0-5
  return team1Wins ? { team1Games: 6, team2Games: loserGames } : { team1Games: loserGames, team2Games: 6 };
}

// Same standard-competition-ranking convention as the rest of the app
// (see web/src/lib/ranking.ts) — tied entries share a rank, and the next
// distinct rank accounts for the tied group's size.
function renderRankingTable(standings: Map<string, PlayerStanding>): string {
  const sorted = [...standings.entries()].sort((a, b) => {
    if (b[1].gamesWon !== a[1].gamesWon) return b[1].gamesWon - a[1].gamesWon;
    if (b[1].gameDiff !== a[1].gameDiff) return b[1].gameDiff - a[1].gameDiff;
    return b[1].setsWon - a[1].setsWon;
  });

  const rows: string[] = [];
  let previousRank = 0;
  let previous: PlayerStanding | null = null;
  sorted.forEach(([playerId, s], index) => {
    const tied =
      previous !== null &&
      s.gamesWon === previous.gamesWon &&
      s.gameDiff === previous.gameDiff &&
      s.setsWon === previous.setsWon;
    const rank = tied ? previousRank : index + 1;
    previousRank = rank;
    previous = s;
    rows.push(
      `| ${rank} | ${playerId} | ${s.gamesWon} | ${s.gameDiff >= 0 ? '+' : ''}${s.gameDiff} | ${s.setsWon} |`
    );
  });

  return ['| Rank | Player | Games Won | Diff | Sets Won |', '|---|---|---|---|---|', ...rows].join('\n');
}

function renderMatchesTable(matches: (MatchRecord & { court: number })[]): string {
  const rows = [...matches]
    .sort((a, b) => a.court - b.court)
    .map(
      (m) =>
        `| ${m.court} | ${m.team1PlayerIds.join(' + ')} | ${m.team2PlayerIds.join(' + ')} | ${m.team1Games}-${m.team2Games} |`
    );
  return ['| Court | Team 1 | Team 2 | Score |', '|---|---|---|---|', ...rows].join('\n');
}

function main() {
  const { players: playerCount, rounds: roundCount, out } = parseArgs(process.argv.slice(2));
  const playerIds = Array.from({ length: playerCount }, (_, i) => playerLabel(i));

  const allMatches: (MatchRecord & { court: number })[] = [];
  const reportSections: string[] = [`# Pairing Simulation — ${playerCount} players, ${roundCount} rounds`];

  for (let round = 1; round <= roundCount; round++) {
    const orderedPlayerIds = round === 1 ? randomOrder(playerIds) : rankByStandingsSoFar(allMatches, playerIds);
    const history =
      round === 1 ? { previousRound: new Set<string>(), earlier: new Set<string>() } : buildPartnershipHistory(allMatches, round);

    const courts = courtsFromOrderedPlayers(round, orderedPlayerIds, history);

    const roundMatches: (MatchRecord & { court: number })[] = courts.map((c) => ({
      round: c.round,
      court: c.court,
      team1PlayerIds: c.team1PlayerIds,
      team2PlayerIds: c.team2PlayerIds,
      status: 'COMPLETE',
      ...simulateScore(),
    }));
    allMatches.push(...roundMatches);

    const standingsAfterRound = computeStandings(allMatches, playerIds);

    reportSections.push(
      [
        `## Round ${round}`,
        '',
        '### Matches',
        renderMatchesTable(roundMatches),
        '',
        `### Ranking after round ${round}`,
        renderRankingTable(standingsAfterRound),
      ].join('\n')
    );
  }

  // Per-player count of rounds where that round's partner had already
  // been their partner in some earlier round (order-independent —
  // affects both players in the repeated pair equally).
  const partnersSoFar = new Map<string, Set<string>>(playerIds.map((id) => [id, new Set<string>()]));
  const repeatCounts = new Map<string, number>(playerIds.map((id) => [id, 0]));
  for (const match of [...allMatches].sort((a, b) => a.round - b.round)) {
    for (const [x, y] of [match.team1PlayerIds, match.team2PlayerIds] as [string, string][]) {
      if (partnersSoFar.get(x)!.has(y)) {
        repeatCounts.set(x, repeatCounts.get(x)! + 1);
        repeatCounts.set(y, repeatCounts.get(y)! + 1);
      }
      partnersSoFar.get(x)!.add(y);
      partnersSoFar.get(y)!.add(x);
    }
  }

  const histogram = new Map<number, number>();
  for (const count of repeatCounts.values()) {
    histogram.set(count, (histogram.get(count) ?? 0) + 1);
  }
  const histogramRows = [...histogram.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([occurrences, playersCount]) => `| ${occurrences} | ${playersCount} |`);

  reportSections.push(
    [
      '## Summary',
      '',
      '### Players by repeat-partner occurrences',
      '(How many rounds each player was paired with someone they\'d already partnered earlier this simulation.)',
      '',
      '| Occurrences | Players |',
      '|---|---|',
      ...histogramRows,
    ].join('\n')
  );

  const report = reportSections.join('\n\n');
  if (out) {
    writeFileSync(out, report);
    console.error(`Wrote ${out}`);
  } else {
    console.log(report);
  }
}

main();
