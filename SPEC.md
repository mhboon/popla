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

### Registration

A matchday can be built either of two ways:

- **Direct**: an admin picks the final, already-a-multiple-of-4
  participant list up front (the original flow).
- **Open registration**: an admin opens a matchday for registration with
  a capacity (`maxParticipants`, e.g. 16 for 4 courts) instead of a fixed
  list. While registration is open:
  - Any logged-in participant can join or leave for themselves.
  - An admin can also add or remove any participant directly — this is
    the only way a **guest** (see below) gets onto the roster, since a
    guest has no login to self-serve with.
  - Joining once capacity is reached waitlists the participant instead of
    failing. Leaving a confirmed spot automatically promotes the
    longest-waiting waitlisted participant into it.
  - The admin closes registration once the confirmed ("joining")
    count is a non-zero multiple of 4, locking in that roster (anyone
    still waitlisted, or who declined, is dropped) and moving the
    matchday into the same setup/round-generation flow as the direct
    path. From this point on, direct and open-registration matchdays are
    indistinguishable.

### Guest participants

A participant doesn't need a phone number / login to be added to a
matchday, a ranking, or a season — an admin can register a **guest**:
a `Player` with no phone and therefore no Cognito account. Guests:

- Appear identically to any other participant in matchday rosters,
  matchday rankings, and season standings — nothing about scoring or
  ranking treats a guest differently.
- Can't self-serve registration (no login) — an admin adds/removes them
  from a matchday's roster directly (see Registration above).
- Can be promoted to a full, logged-in participant at any time by an
  admin giving them a phone number — the same action that turns any
  participant's login on (see Phase 2 below); no separate "promote"
  action exists.

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
1. Total games won (descending) — **not** sets won, and primary over
   game differential. This rewards consistent, competitive effort across
   every set played, rather than penalizing a player for close losses
   the same way a blowout loss is penalized — see the first example
   below for why that distinction matters.
2. Game differential: games won minus games lost (descending), as the
   tiebreaker when total games won is equal.
3. Sets won (descending).

Example (why total games won, not game differential, is primary): a
player who loses all 4 sets 5-6 has 0 sets won, 20 games won (5 × 4),
24 games lost, and a game differential of -4. A player who wins 3 sets
6-5 and loses 1 set 0-6 has 3 sets won, 18 games won, 21 games lost, and
a game differential of -3. Ranking by game differential alone would put
the 3-1 player above the 0-4 player — but the 0-4 player fought to 5
games in every single set, a more consistent, competitive effort than
the 3-1 player's mix of narrow wins and one lopsided 0-6 loss. Total
games won correctly ranks the 0-4 player first (20 > 18).

Example (why game differential, not sets won, is the next tiebreaker,
when total games won ties): a player who wins one set 6-3 and loses the
other 4-6 has 10 games won, 9 games lost, a game differential of +1,
and 1 set won. A player who wins one set 6-1 and loses the other 4-6
also has 10 games won and 1 set won — tied with the first player on
both total games won and sets won — but only 7 games lost, for a game
differential of +3. Sets won can't break this tie (both 1-1); game
differential can, and correctly ranks the second player above the
first, since a 6-1 win is more dominant than a 6-3 win even though both
are single set wins.

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

### Winner Points ("streepjes")

Each closed matchday also awards a "winner point" (streepje) to some of
its participants, on top of season points:

- Every participant who won **all** their sets that matchday (i.e.
  `setsWon` equals the number of rounds played) earns a winner point —
  this can be more than one player (e.g. 3 rounds, 3 players each go
  3-0: all 3 earn a winner point).
- **Unless** fewer than 2 participants won all their sets. In that case,
  the day ranking's rank 1 and rank 2 earn the winner point instead —
  including a rank-1/rank-2 player who already qualified by winning all
  their sets, topped up with the next-ranked player(s) needed to reach 2
  recipients. For example: 1 player goes undefeated (3-0) — that player
  earns a winner point, and so does whoever ranks 2nd. If nobody goes
  undefeated, ranks 1 and 2 both earn the winner point.

Season ranking is the sum of season points across all matchdays in the
current season; a separate "round winners" season ranking is the sum of
winner points across all matchdays in the current season.

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

### Phase 2

- Individual login for **everyone** — participants and admins alike —
  fully passwordless: phone number → SMS code (10 min validity) →
  logged in. No password ever exists, so there's no separate
  forgot-password flow to build — requesting a fresh code covers it. A
  participant's phone number is admin-registered only (no public
  self-signup); an admin can change it later, except for a participant
  who is themselves an admin (see Roles & Access below).
  See `ARCHITECTURE.md`'s Auth section for the Cognito implementation.
- Logged-in, non-admin participants can, beyond viewing seasons and
  matchdays (results, rankings): join or leave a matchday that's open for
  registration (see Registration above), for themselves only — no other
  edit/action capability, no admin controls are shown, let alone enabled.
- Admin status itself is manageable by existing admins, through the UI:
  promote a registered participant to admin, or demote one (an admin
  can't demote themselves, to avoid stranding the promote/demote UI if
  they're the only admin). The very first admin, and any admin account
  not tied to a participant at all, is set up via the AWS console.

### Phase 3 (future, not yet built)

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

- Any additional tiebreak rules for season ranking beyond total points
  (e.g. is game differential also summed across the season as a tiebreak?).
  Applies equally to the round-winners season ranking (ties on total
  winner points).
