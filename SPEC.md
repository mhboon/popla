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

One flow: creating a matchday means picking a date/format and,
optionally, an already-known set of participants — as many or as few as
the admin has confirmed so far (could be all of them, some of them, or
none yet). Every matchday also has a **self-registration** toggle, set
at creation and changeable later:

- **On**: any logged-in participant can register or unregister
  themselves, right up until the admin starts the matchday. An admin can
  still add or remove anyone directly too, at any time — this is also
  the only way a **guest** (see below) gets onto the roster, since a
  guest has no login to self-serve with.
- **Off**: only an admin can add or remove participants; nobody can
  self-register.

An optional capacity (`maxParticipants`) applies either way, independent
of the toggle: registering past it waitlists the participant instead of
failing, whether they registered themselves or an admin added them.
Leaving a confirmed spot (opting out) automatically promotes the
longest-waiting waitlisted participant into it. With no capacity set,
nobody is ever waitlisted.

The admin starts the matchday (generating round 1) once the confirmed
("registered") count is a non-zero multiple of 4 — this both locks in
that roster (anyone still waitlisted, or who declined, is dropped) and
begins play; there's no separate "close registration" step. Right
before starting, the admin can bulk-review and adjust the final list
(add/remove several people at once) rather than one at a time.

Everyone (not just admins) can see the current roster and waiting list,
in order, on a matchday that hasn't started yet: registered participants
newest-first, waitlisted participants oldest-first (i.e. queue order —
who gets promoted next).

### Guest participants

A participant doesn't need a phone number / login to be added to a
matchday, a ranking, or a season — an admin can register a **guest**:
a `Player` with no phone and therefore no Cognito account. Guests:

- Appear identically to any other participant in matchday rosters and
  matchday (day) rankings — nothing about within-matchday scoring treats
  a guest differently.
- **Excluded from all season-level rankings** (season points, round
  winners, and the weighted ranking — see Season Points below). This is
  evaluated live off current guest status, not a snapshot: a participant
  who loses their phone number drops out of season rankings immediately,
  and one who gains a phone number appears immediately. Season points
  still accrue for a guest in the background while they're excluded, so
  a guest later promoted to a full participant shows up with their full
  season total already intact — no history is lost.
- Can't self-serve registration (no login) — an admin adds/removes them
  from a matchday's roster directly (see Registration above).
- Can be promoted to a full, logged-in participant at any time by an
  admin giving them a phone number — the same action that turns any
  participant's login on (see Phase 2 below); no separate "promote"
  action exists. The reverse (an admin clearing a participant's phone
  number) reverts them to guest status the same way.

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
   picked per the Partner Assignment rule below.
5. Repeat steps 2–4 for each subsequent round the admin generates
   (re-rank → re-bucket → randomize within bucket each time), until the
   admin ends the matchday.

**Americano** (fully random):
- Every round, all N participants are randomly reshuffled into new groups
  of 4 — independent of standings or which group anyone was in before.
  Within each freshly-formed group, the two teams are picked per the same
  Partner Assignment rule below.

**Partner Assignment** (both formats, within a single already-formed
group of 4): the 2v2 split is randomized — not a fixed seeding rule —
but weighted to avoid repeat partnerships *within that same group*, this
matchday only:
- **Hard rule**: never reconstruct a partnership from the immediately
  previous round. Always possible — each of the 4 players has at most
  one partner from that round, so at most one of the 3 possible splits
  can ever collide with it.
- **Soft rule**: among whatever's left, prefer the split with the fewest
  partnerships repeated from any *earlier* round (not the previous one).
  If every remaining option repeats something, that's accepted — this is
  a preference, not a guarantee.
- This only ever looks within the one group of 4 being split — it never
  reaches into a different court's group to avoid a repeat, and it has
  no effect on which players land in a group together in the first place
  (for Mexicano that's the standings-based ranking above; for Americano
  it's the fully random reshuffle, which never tries to keep or split up
  any particular group of 4 based on history — only who partners with
  whom *inside* whatever group they're randomly placed into is
  protected against repeats). Opponent repeats (facing the same pair
  across the net again) are never tracked or avoided, only partnerships.

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

### Weighted Ranking

A third season-level ranking surfaces relative performance instead of raw
totals, so someone who's played fewer matchdays isn't automatically
outranked by someone who's simply played (and shown up for) more:

- **Qualification**: only participants who have played at least 25% of
  the season's closed matchdays so far (rounded up — e.g. 25% of 6 closed
  matchdays = 1.5, so 2 matchdays played is the minimum) appear in this
  ranking. "Played" means closed matchdays the participant actually took
  part in (earned season points that day), not just self-registered for.
  This threshold is recomputed against the current count of closed
  matchdays as the season progresses, so a participant who qualified
  earlier in the season can later drop out of the ranking if their own
  matchday count doesn't keep pace — this is expected, not a bug.
- **Score**: a weighted average of the participant's season points across
  the matchdays they played, where each matchday is weighted by
  `ln(N)` (N = that matchday's participant count), so points earned in
  bigger, more competitive fields count for more toward the average than
  points earned in smaller ones:

  ```
  weighted_avg = Σ(points_i × ln(N_i)) / Σ(ln(N_i))
  ```

  (sum over the matchdays `i` the participant played; `points_i` is the
  season points they earned that matchday, `N_i` is that matchday's
  participant count).
- Applies to season points only — the round-winners ranking has no
  weighted-average equivalent.
- Guests are excluded, same as the other two season-level rankings (see
  Guest participants above).
- **Tiebreak**: more matchdays played wins the tie, then total season
  points.

### Season ranking UI

The season page has four tabs — season points, round winners, weighted
ranking (third), and matchdays — collapsing to a dropdown selector
instead of tabs when they don't fit (e.g. on mobile). The weighted
ranking tab shows,
above its table, the current minimum-matchdays-required number (see
Qualification above), and below the table, a plain-language explanation
of how the weighted average is calculated. Its table columns are:
participant, average points, and number of participations.

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

- Individual login for **everyone** — participants and admins alike.
  Phone number → SMS code (10 min validity) is how everyone signs in the
  first time and is the self-service way to (re)set a password; once
  set, a password signs in faster on return visits without waiting on an
  SMS. There's no separate self-service forgot-password flow to build
  beyond the SMS-code sign-in itself — requesting a fresh code and
  setting a new password covers it. If someone can't complete that (lost
  the phone, SMS not arriving), an admin can also issue a one-time
  temporary password from outside the app — see README.md's Resetting a
  password. A participant's phone number is admin-registered only (no
  public self-signup); an admin can change it later, except for a
  participant who is themselves an admin (see Roles & Access below).
  See `ARCHITECTURE.md`'s Auth section for the Cognito implementation.
- Logged-in, non-admin participants can, beyond viewing seasons and
  matchdays (results, rankings): register or unregister themselves for a
  not-yet-started matchday with self-registration on (see Registration
  above), for themselves only — no other edit/action capability, no
  admin controls are shown, let alone enabled. The home page surfaces
  any such matchday with the participant's own status (not registered /
  registered / waitlisted) and, once it's started, drops it from view
  again unless they actually ended up in it — an admin keeps seeing it
  regardless, for operational access (recording scores etc.).
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
