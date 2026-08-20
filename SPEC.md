# Popla Cup — Specification

## Overview

The Popla Cup is a weekly padel tournament ("matchday") played among a large
pool of volunteer participants. Results from each matchday feed into a
longer-running "season" ranking.

## Core Concepts

### Season

- A season is a period during which matchday results accumulate into a
  season ranking.
- A season can be closed by an admin. Closing a season is a durable action —
  closed seasons and their full history (matchdays, results, rankings)
  persist indefinitely and remain viewable.
- After closing a season, a new season can be started, with point totals
  reset to zero.

### Matchday

- A matchday is a single Friday's tournament instance, belonging to exactly
  one season.
- Participants: between 12 and 28+ people (must be a multiple of 4; 32 is a
  valid/likely upper case).
- Format: each matchday is designated as either **Mexicano** or
  **Americano** at creation time (see Match Generation below).
- Structure: a matchday consists of **one or more rounds** — there's no
  fixed count. Each round, all N participants are split across N/4
  courts, and each court plays one set. After a round's sets are all
  recorded, the admin decides whether to generate another round or end
  (close) the matchday.
- Set scoring: played to 6 games. No tiebreak at 6-6 (does not apply — see
  below), and no requirement to win by 2 games. First to 6 games wins the
  set, e.g. a set can validly end 6-5.

### Match Generation

Two supported formats, selectable per matchday:

**Mexicano** (standings-based):
1. Round 1: all N participants are randomly assigned to courts (4 players
   per court).
2. After each round, participants are ranked by current matchday standings
   (see Day Ranking below).
3. Participants are bucketed into groups of 4 in rank order: ranks 1–4 to
   one court, ranks 5–8 to the next, and so on.
4. Within each group of 4, the two teams (partner/opponent assignment) are
   randomized — not a fixed seeding rule.
5. Repeat steps 2–4 for each subsequent round the admin generates
   (re-rank → re-bucket → randomize within bucket each time), until the
   admin ends the matchday.

**Americano** (fully random):
- Every round, all N participants are randomly shuffled into courts and
  team pairings, independent of standings or prior rounds. No attempt is
  made to avoid repeat partners/opponents across rounds.

### Day Ranking (within a matchday)

Participants are ranked at the end of a matchday by, in order:
1. Game differential: games won minus games lost (descending). This is
   primary rather than raw games won specifically so that losses count
   against a player, not just wins for them — see the first example
   below for why that distinction matters.
2. Total games won (descending) — **not** sets won. A player who wins
   fewer sets but more total games (e.g. several close losses) can
   outrank a player who wins more sets by lopsided margins.
3. Sets won (descending).

Example (why game differential, not raw games won, must be primary): a
player who loses all 4 sets 5-6 has 0 sets won but 20 games won (5 × 4)
against 24 games lost, for a game differential of -4. A player who wins
3 sets 6-0 and loses 1 set 0-6 has 3 sets won and only 18 games won, but
a game differential of +12. Ranking by raw games won alone would put the
0-3 player above the 3-1 player, which is clearly wrong — game
differential correctly ranks the 3-1 player first.

Example (why total games won, not sets won, is the next tiebreaker,
when game differential ties): a player who wins sets 6-4 and 4-6 has 1
set won, 10 games won, 10 games lost, and a game differential of 0. A
player who wins sets 6-0 and 0-6 also has 1 set won, but only 6 games
won, 6 games lost, and the same game differential of 0. Sets won can't
break this tie (both 1-1) — games won can, and correctly ranks the
first player (who played two competitive, closely-contested sets)
above the second (who played two lopsided sets that canceled out).

### Season Points

Each matchday awards season points per participant based on their day
ranking position (rank 1 = best):

- Rank 1 (winner): `N` points, where N = number of participants in that
  matchday.
- Rank `r` for `r >= 2`: `N - r` points.
- Last place (rank N): `0` points.

Note this scale intentionally has no participant scoring `N - 1` points —
only rank 1 scores `N`, and rank 2 already drops to `N - 2`.

Season ranking is the sum of season points across all matchdays in the
current season.

### Streepjes (deferred)

- The matchday winner (and in some cases the runner-up) earns a "streepje"
  (mark/tally) that factors into the season ranking in some way.
- Exact rules are not yet known and are out of scope until clarified.

## Roles & Access

Admin is a role a user holds, not a separate class of person — admins are
themselves typically also participants, and a user can switch between
acting as admin and acting as participant. Access control is therefore
per-user role-based (e.g. an `isAdmin` flag / admin group membership), not a
separate admin login.

### Phase 1

- **Admin role**, initially the only way to interact with the system:
  - Start a matchday (select season, format, register participant list).
  - Generate matches per round.
  - Record set results.
  - Close a matchday (finalizes day ranking and season points).
  - View matchday ranking and season (total) ranking.
  - Close a season / start a new season.
- **Participant role**: no login/access yet in phase 1 — participants are
  just names entered by an admin when building the matchday's participant
  list.

### Phase 2+

- Individual login for participants, starting with a standard sign-up/login
  and later moving to **social login** (e.g. Google/Facebook via a
  federated identity provider) so participants don't need to manage a
  separate password.
- Logged-in participants (including admins acting in their participant
  capacity) can:
  - View matchday results and season rankings.
  - Make score predictions and compare predicted vs. actual results.
  - View personal stats: favorable/unfavorable partner and opponent
    combinations ("good and bad combos").

## Tech Stack & Deployment

- **Infrastructure as code:** AWS CDK (TypeScript).
- **CI/CD:** GitHub Actions, deploying via the CDK app.
- **Target architecture:** AWS serverless — CloudFront, AppSync (native
  resolvers to DynamoDB where possible, Lambda resolvers to DynamoDB
  otherwise), DynamoDB, Cognito (see architecture design, to follow).
- **Domain:** no custom domain initially (default CloudFront/AppSync
  endpoints); a custom domain will be introduced later.

## Open Questions

- Exact streepjes rules (when awarded, how they affect season ranking).
- Any additional tiebreak rules for season ranking beyond total points
  (e.g. is game differential also summed across the season as a tiebreak?).
