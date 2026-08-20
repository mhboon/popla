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
1. Total games won (descending) — **not** sets won. A player who wins
   fewer sets but more total games (e.g. several close losses) can
   outrank a player who wins more sets by lopsided margins.
2. Game differential: games won minus games lost (descending).

Example (tiebreak only, both criteria give the same order here): a
player who wins sets 6-0, 6-0, 6-0, 6-0 outranks a player who wins sets
6-1, 6-1, 6-1, 6-1 — both won 24 games (winning a set always means
winning exactly 6 games, regardless of the loser's score), so this comes
down to the second criterion: the first player's game differential
(+24) beats the second's (+20).

Example (where this actually differs from ranking by sets won): a
player who wins one set 6-0 and loses three sets 5-6 has 1 set won but
21 games won (6 + 5 + 5 + 5). A player who wins two sets 6-0 and loses
two sets 0-6 has 2 sets won but only 12 games won. The first player
outranks the second, despite winning fewer sets — they were competitive
throughout instead of blowing out two matches and getting blown out in
the other two.

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
