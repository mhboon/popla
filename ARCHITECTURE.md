# Popla Cup — Architecture

Companion to `SPEC.md`. Describes the target AWS serverless architecture and
the CDK/CI setup that deploys it.

## Diagrams

AWS architecture diagrams, drawn with official AWS4 icons, live in
[`docs/`](docs/) as draw.io files — open them in
[diagrams.net](https://app.diagrams.net), the draw.io desktop app, or the
VS Code draw.io extension:

- [`docs/popla-request-path.drawio`](docs/popla-request-path.drawio) —
  browser → CloudFront/S3 and browser → AppSync, with the native-vs-Lambda
  resolver split front and center: reads and most writes resolve
  **natively** (an AppSync JS resolver straight to DynamoDB, no compute in
  between); only `generateRound` (Mexicano/Americano pairing) and
  `closeMatchday` (scoring, ranking, season-points transaction) — the two
  mutations with real algorithmic content — detour through Lambda before
  reaching the same tables. Rendered:
  ![Request path diagram](docs/popla-request-path.png)
- [`docs/popla-deploy-path.drawio`](docs/popla-deploy-path.drawio) — how a
  merged PR reaches AWS: GitHub Actions exchanges a short-lived OIDC token
  with AWS STS to assume an IAM deploy role (no stored AWS keys), then
  runs `cdk deploy` against CloudFormation to update `PoplaBackendStack`
  and `PoplaWebStack`. The one account-specific value in that whole flow —
  the deploy role's ARN — exists solely as the `AWS_DEPLOY_ROLE_ARN`
  GitHub secret, which is why it never surfaces in source or in this
  repo's Actions logs, even though `cdk deploy` itself prints ARNs that
  contain it. Rendered:
  ![Deploy path diagram](docs/popla-deploy-path.png)

Rendered PNGs are checked in so the diagrams show up inline on GitHub
(which doesn't render `.drawio` XML); regenerate them from the source
files whenever the diagrams change, since nothing enforces they stay in
sync automatically.

## Stack Overview

- **Frontend:** React + Vite + TypeScript (`web/`). A plain `fetch`-based
  GraphQL client rather than Apollo/Amplify — the API surface is small
  enough that a full client library isn't worth the dependency weight.
  Cognito auth via `amazon-cognito-identity-js`: `USER_SRP_AUTH` for
  password sign-in, `CUSTOM_AUTH` for the SMS-OTP sign-in used to
  establish or reset a password (see the Auth section below).
- **Frontend hosting:** S3 (private, Origin Access Control) + CloudFront.
- **API:** AWS AppSync (GraphQL), Cognito User Pool authorizer.
- **Business logic:** AppSync JS (native) resolvers to DynamoDB for CRUD/
  reads and simple writes; Lambda resolvers for the two operations with
  real algorithmic logic (round generation, matchday close).
- **Data:** DynamoDB, one table per entity (not single-table design — this
  app's scale and access patterns don't warrant the added complexity).
- **Auth:** Cognito User Pool, `Admins` group, phase-2 federated social
  login (Google etc.) on the same pool.
- **IaC:** AWS CDK (TypeScript), two stacks (`PoplaBackendStack`,
  `PoplaWebStack`).
- **CI/CD:** GitHub Actions, deploying via `cdk deploy`, authenticated to
  AWS via GitHub OIDC (no long-lived access keys).
- **Domain:** default CloudFront/AppSync endpoints for now; Route53 + ACM
  custom domain to be added later, in front of both the web distribution
  and the API.

## Data Model (DynamoDB)

Plain multi-table design. Each table below is a physical DynamoDB table.

### `Players`
- PK: `playerId`
- Attributes: `displayName`, `phone` (optional, international, digits
  only, no leading `+` — see Auth below), `cognitoSub` (nullable — set when an admin registers/
  changes the player's `phone`, via `AdminCreateUser`, not on first
  login; see Auth below), `createdAt`.
- Persists across seasons — this is the durable identity a matchday
  participant and season standings entry both point back to.
- A player with no `phone` is a **guest** (see SPEC.md) — `Player.isGuest`
  on the GraphQL type is computed as `!phone` in the `listPlayers`/
  `getMyPlayer` resolvers, not stored.
- GSI `byPhone`: PK `phone` — sparse (guests are absent from it, having no
  `phone`). Used by `getMyPlayer` and the `setMatchdayJoining` Lambda to
  resolve "which Player is the caller" from `ctx.identity.username`
  (Cognito Username == phone number — see Auth below).

### `Seasons`
- PK: `seasonId`
- Attributes: `name`, `status` (`ACTIVE` | `CLOSED`), `startDate`,
  `closedAt`.

### `Matchdays`
- PK: `matchdayId`
- Attributes: `seasonId`, `date`, `startTime` (optional time-of-day —
  kept as a separate attribute rather than folding into `date` so
  existing rows don't need migrating), `format` (`MEXICANO` |
  `AMERICANO`), `status` (`SETUP` | `IN_PROGRESS` | `CLOSED`),
  `selfRegistrationEnabled` (whether a non-admin caller may target
  themselves via `setMatchdayJoining` while `SETUP` — see SPEC.md's
  Registration), `maxParticipants`/`joinedCount` (an optional cap +
  its atomic counter, meaningful independent of
  `selfRegistrationEnabled` — applies to *any* join, self- or
  admin-added. Both absent when uncapped; `joinedCount` is
  internal bookkeeping for `set-matchday-joining`'s capacity-check
  transaction only, not exposed on the GraphQL type).
- GSI `bySeasonId`: PK `seasonId`, SK `date` — list matchdays in a season,
  chronologically.

### `MatchdayParticipants`
- PK: `matchdayId`, SK: `playerId`
- The registered participant list for a matchday. Count must be a
  non-zero multiple of 4 by the time `generateRound` first runs (see
  Resolver Split below) — not enforced before that, so the roster can
  sit at any size (including zero) while still `SETUP`.
- Attributes `status` (`JOINING` | `WAITLISTED` | `DECLINED`) and
  `updatedAt`, both written by every writer now (`createMatchday`,
  `setMatchdayJoining`) — a row with no `status` pre-dates this
  entirely and reads as `JOINING` wherever it's read
  (`generateRound`, `listMatchdayParticipantIds`,
  `listMatchdayParticipants`'s response mapper). `updatedAt` orders
  waitlist promotion FIFO, and separately powers "who registered
  when" (`listMatchdayParticipants`, sorted client-side: newest-first
  for `JOINING`, oldest-first — queue order — for `WAITLISTED`).

### `Matches`
- PK: `matchdayId`, SK: `ROUND#<n>#COURT#<c>`
- Attributes: `round`, `court`, `team1PlayerIds` (2), `team2PlayerIds`
  (2), `team1Games`, `team2Games`, `status` (`PENDING` | `COMPLETE`).
- One item per set (N/4 courts per round, one or more rounds per
  matchday — see SPEC.md).

### `MatchdayResults`
- PK: `matchdayId`, SK: `playerId`
- Attributes: `setsWon`, `gamesWon`, `gamesLost`, `gameDiff`, `rank`,
  `seasonPoints`, `winnerPoint` (bool — see SPEC.md's Winner Points),
  `seasonId` (denormalized for reference).
- Written once, by the `closeMatchday` Lambda, from the completed
  `Matches` for that matchday.
- GSI `byMatchdayRank`: PK `matchdayId`, SK `rankScore` (number) — a
  precomputed 3-level encoding of `(gamesWon, gameDiff, setsWon)`, each
  level given enough headroom that it dominates the levels below it, so
  a plain descending `Query` returns the day ranking (games won desc,
  then game diff desc, then sets won desc — see SPEC.md's Day Ranking)
  directly. No client-side or resolver-side sorting needed.

### `SeasonStandings`
- PK: `seasonId`, SK: `playerId`
- Attributes: `totalPoints`, `matchdaysPlayed`, `winnerPoints` (sum of
  winner points across the season's closed matchdays — see SPEC.md).
- Incrementally updated (atomic `ADD`) by `closeMatchday`, in the same
  transaction as the `MatchdayResults` write.
- GSI `bySeasonPoints`: PK `seasonId`, SK `totalPoints` — descending
  `Query` gives the season leaderboard directly, native resolver, no
  Lambda involved on read.
- GSI `bySeasonWinnerPoints`: PK `seasonId`, SK `winnerPoints` — same
  idea, for the "round winners" season ranking.

### Backups

Every table above has `pointInTimeRecoverySpecification` enabled — 35
days of continuous point-in-time recovery, AWS's own restore mechanism.
`PoplaOtpChallenges` (not listed above — it's the SMS-OTP challenge
state from the Auth section below, not app data) deliberately doesn't:
it's TTL'd ephemeral codes, nothing worth recovering.

On top of that, `BackupTablesFn` (`infra/lambda/backup-tables`) scans
every table above once daily (`BackupTablesSchedule`, 03:00 UTC cron)
and writes one plain JSON array per table to `BackupBucket`
(`s3://<bucket>/<YYYY-MM-DD>/<TableName>.json`), which expires objects
after 28 days via an S3 lifecycle rule. This is deliberately a plain
`Scan` + `JSON.stringify`, not DynamoDB's native `ExportTableToPointInTime`:
these tables are tiny (low hundreds of items at most), so the RCU cost
of a daily scan is negligible, and a flat, human-readable JSON file per
table is far easier to inspect or restore from by hand than the native
export's sharded/manifest format — matching this repo's existing
`local/` reconciliation scripts' style, rather than requiring a
different restore process for a totally separate reason to reach for
one.

## Resolver Split

**Native (AppSync JS resolvers, direct to DynamoDB):**
- `listPlayers`, `getMyPlayer` — the latter is a `Players.byPhone` GSI
  query keyed on `ctx.identity.username`, returning the caller's own
  `Player` (or null); both compute `isGuest` (`!phone`) in the response
  mapper.
- `getSeason`, `listSeasons`
- `getMatchday`, `listMatchdaysBySeason`, `listMatchdayParticipantIds`,
  `listMatchdayParticipants` (the latter includes RSVP `status`, missing
  → `JOINING`)
- `listMatches(matchdayId, round?)`
- `getMatchdayRanking(matchdayId)` — Query on `MatchdayResults.byMatchdayRank`
- `getSeasonStanding(seasonId)` — Query on `SeasonStandings.bySeasonPoints`
- `getSeasonWinnerRanking(seasonId)` — Query on `SeasonStandings.bySeasonWinnerPoints`
- `createSeason`, `closeSeason`, `reopenSeason` — simple state changes.
  Only one `ACTIVE` season at a time is a UI-enforced convention, not a
  data-layer constraint — see Open Questions.
- `createMatchday` — writes the `Matchdays` item (`status: SETUP`,
  `selfRegistrationEnabled`, and `maxParticipants`/`joinedCount` if
  capped) plus a `JOINING` row per (optional, any-length) initial
  `participantId` — simple enough, still, to stay native even though it
  no longer validates a multiple of 4 up front (see `generateRound`
  below for where that check now lives).
- `recordSetResult(matchId, team1Games, team2Games)` — JS resolver
  validates the score (`max(team1Games, team2Games) == 6`,
  `min(...) < 6`, i.e. no tiebreak, no win-by-2 requirement) directly in
  the resolver's condition expression before the `UpdateItem`

**Lambda resolvers (real business logic):**
- `generateRound(matchdayId)` — determines the round number itself (one
  past the highest round already generated, or 1 if none yet — there's
  no fixed round count, see `SPEC.md`), reads current standings (round 1:
  the participant list, unranked; later rounds: the interim per-matchday
  standings computed from completed `Matches` so far — see note below),
  runs the Mexicano or Americano pairing algorithm per `SPEC.md`,
  batch-writes the `Matches` items for that round. On round 1 specifically,
  this is also where "closing registration" now happens, folded into
  starting play instead of being its own mutation: validates a non-zero
  multiple of 4 `JOINING` participants (throwing otherwise, before any
  writes), deletes any still-`WAITLISTED`/`DECLINED` rows, and flips
  `Matchdays.status` from `SETUP` to `IN_PROGRESS` — which is what makes
  the matchday stop being editable (both by admin roster changes and,
  implicitly, self-registration).
- `closeMatchday(matchdayId)` — aggregates all generated rounds' complete
  `Matches`, computes each player's setsWon/gamesWon/gamesLost/gameDiff/
  rank/seasonPoints/winnerPoint, writes `MatchdayResults`, and atomically
  increments `SeasonStandings` (`totalPoints`, `matchdaysPlayed`, and
  `winnerPoints`) in a single DynamoDB transaction. Also flips
  `Matchdays.status` to `CLOSED`. The admin decides when to stop
  generating rounds and call this — there's no fixed round count.
  Winner-point eligibility (SPEC.md) needs the number of rounds played,
  taken as the highest `round` among that matchday's `Matches`.
- `updateMatchday(matchdayId, date?, format?, selfRegistrationEnabled?,
  maxParticipants?)` — only allowed while `status == SETUP`. No longer
  touches the roster at all (that's `setMatchdayJoining`'s job
  exclusively now, whether the caller is an admin or a self-registering
  participant — see below); this is just the `Matchdays` item's own
  attributes. Setting or raising/lowering `maxParticipants` re-queries
  the current `JOINING` count to (re)seed `joinedCount` accurately and
  reject lowering the cap below it — real enough to stay Lambda even
  though the write itself is a plain `UpdateItem`.
- `createPlayer`/`updatePlayer` — provision/deprovision the player's
  Cognito login (`AdminCreateUser`/`AdminDeleteUser`, keyed by phone —
  see Auth below) alongside the `Players` write, and (in `updatePlayer`)
  block a phone-number change for a player who's currently an admin.
- `promoteToAdmin`/`demoteFromAdmin(playerId)` — `AdminAddUserToGroup`/
  `AdminRemoveUserFromGroup` against the player's Cognito user;
  `demoteFromAdmin` rejects removing the caller's own admin status.
- `setMatchdayJoining(matchdayId, playerId?, joining)` — the one mutation
  for *any* roster change now, admin-driven or self-service. Not
  `@aws_auth`-restricted (any authenticated user can call it for their
  own RSVP), so the Lambda itself enforces the caller: targeting another
  player (`playerId` set) requires `ctx.identity.groups` to include
  `Admins`; targeting self (omitted) additionally requires
  `Matchdays.selfRegistrationEnabled` — the identity resolution itself
  (via `Players.byPhone` on `ctx.identity.username`), plus the
  capacity/waitlist handling below, is real enough logic to need Lambda.
  Idempotent no-op if already in the requested state (`JOINING`/
  `WAITLISTED` when joining, absent/`DECLINED` when leaving). Joining:
  uncapped (`maxParticipants` unset) is a plain `PutItem`, no counter
  touched; capped is one transaction conditionally `ADD`ing
  `Matchdays.joinedCount` (`< maxParticipants`) alongside writing the
  `JOINING` row, falling back to a plain `WAITLISTED` write on a failed
  condition (full). Leaving a `JOINING` row: queries the matchday's other
  participants for the `WAITLISTED` one with the oldest `updatedAt` and,
  in one transaction, flips it to `JOINING` while the leaver becomes
  `DECLINED` (counter untouched, net zero); with nobody waitlisted, the
  leaver becomes `DECLINED`, and (only if capped) `joinedCount`
  decrements in the same transaction. The admin's "finalize participants"
  bulk editor on `MatchdayPage` is purely a frontend convenience over
  this same mutation — it diffs a multiselect against the current roster
  and fires one call per changed player, so bulk edits behave identically
  to (and can't diverge from) individual self-RSVP.
- `listAdminPhoneNumbers` — one `ListUsersInGroup` call against the
  `Admins` group, used by the admin UI to know which players are
  currently admins without an AdminListGroupsForUser call per row.

Note: Mexicano's round-over-round re-ranking (every round after the first
depends on the running standings *within that matchday*, not just the
final `MatchdayResults` which are only written at close) means
`generateRound` computes an in-memory/interim ranking from the completed
`Matches` of prior rounds each time it runs, rather than reading a
persisted "day standings so far" table. This keeps `MatchdayResults` as a
single, unambiguous final-ranking table rather than something written
incrementally.

## Auth

- One Cognito User Pool, one login mechanism for everyone, admin or
  participant, layered in two parts: an SMS-OTP sign-in (phone number →
  6-digit code, 10 min validity) that's the only thing that actually
  proves phone ownership, and an optional password set via that OTP
  session (`setMyPassword`) for faster return visits. A brand-new Cognito
  user has no password and must sign in by OTP at least once; "forgot
  password" isn't a separate mechanism, it's the same OTP sign-in run
  again, followed by `setMyPassword` — so it inherits the OTP path's
  existing rate limiting and invalidation guarantees (below) instead of
  needing its own.
- **Cognito `Username` = the user's international phone number, digits
  only, no leading `+`** (e.g. `31612345678`, not `+31612345678` — see
  `infra/lambda/shared/phone.ts`'s `PHONE_REGEX`), for every user in the
  pool, admin or participant, `Player`-linked or not. Cognito always
  accepts signing in with the literal `Username` regardless of alias
  configuration, so this needed no change to `signInAliases` (which —
  see the `UserPoolV2` construct comment — is immutable in-place;
  changing it forces a full pool replacement). A user's Cognito account
  is created at admin-registration time (when an admin sets/changes a
  `Player`'s `phone`), not at first login; the returned `sub` is stored
  as `Players.cognitoSub`. SNS's `Publish` API requires true E.164 (with
  the `+`) to actually deliver an SMS, so `create-auth-challenge`
  prepends it right before that one call — nowhere else needs to.
- **The OTP flow is implemented as Cognito `CUSTOM_AUTH`**, handled
  entirely by three small Lambda triggers on the User Pool
  (`define-auth-challenge`, `create-auth-challenge`,
  `verify-auth-challenge-response`). The current code, its 10-minute
  expiry, and a per-phone send count all live in one DynamoDB table
  (`PoplaOtpChallenges`, PK `phone`, TTL'd) — deliberately **not**
  Cognito's own per-round `privateChallengeParameters`, and this is
  load-bearing, not a style choice: `privateChallengeParameters` is a
  snapshot cached separately for each individual challenge round, so a
  Lambda that trusted it would let an *abandoned* round stay completable
  with its original code for the full 10 minutes even after a newer SMS
  was sent (e.g. the participant left an old browser tab open, then hit
  "Resend"). `verify-auth-challenge-response` instead reads the row for
  `event.userName` fresh, every time, so **sending a new code
  immediately invalidates any code sent before it** — from any device or
  tab, not just within the same session. A wrong guess (which
  re-invokes `create-auth-challenge` with a non-empty `session`) is the
  one path that deliberately does *not* touch the table — it must not
  generate a new code or send a new SMS, only let the existing one keep
  being checked. Sends are capped at **3 per phone per rolling 24
  hours** (`MAX_SENDS_PER_WINDOW` in `create-auth-challenge`); past the
  cap the currently-live code (if any) is left untouched rather than
  cleared, and no further SMS goes out, but the response looks identical
  to the caller either way — the real protection against someone
  hammering a specific person's number, on top of the account-level SNS
  spend limit (set manually, not IaC-managed — see README.md).
  `create-auth-challenge` sends the SMS directly via SNS `Publish`
  (as `Transactional`, not the default `Promotional`, since carriers can
  deprioritize the latter). The User Pool Client has
  `preventUserExistenceErrors: true`, and both `define-auth-challenge`
  and `create-auth-challenge` treat an unregistered number identically
  to a real one (same challenge shape, no real SMS, and
  `verify-auth-challenge-response` always rejects it) — rather than
  failing fast, which would let a caller learn a number isn't registered
  just from how quickly the request fails. Login itself never touches
  AppSync — the frontend talks to Cognito directly via
  `amazon-cognito-identity-js`, same as any other Cognito auth flow.
- **Password sign-in is `USER_SRP_AUTH`**, the User Pool Client's other
  enabled auth flow alongside `custom`. Passwords are set/reset by
  `setMyPassword` (`infra/lambda/set-my-password`) — a Lambda resolver
  restricted to no group, callable by any authenticated user, that always
  targets the *caller's own* Cognito `Username` (read off
  `event.identity.username`, never an argument) via
  `AdminSetUserPassword(..., Permanent: true)`. Reachability, not the
  mutation itself, is what makes this safe: it's only callable with a
  valid session, and the only way to get one without already having a
  password is the OTP flow above — `setMyPassword` does no independent
  verification of its own. Changing a *known* password (Account page) is
  a separate, simpler path: Cognito's own `ChangePassword` API
  (`web/src/lib/auth.ts`'s `changePassword`), called straight from the
  frontend against the signed-in user's session — no Lambda, no
  AppSync — since Cognito already verifies the old password itself.
  `AdminSetUserPassword` with `Permanent: true`
  also always clears `FORCE_CHANGE_PASSWORD`, so `newPasswordRequired`
  (the challenge Cognito raises for an unconfirmed/temporary password) is
  never actually reachable through the app: every Cognito user either has
  no password yet (OTP-only) or a real one set this way. The one path
  that bypasses this — a break-glass admin created directly via
  `admin-create-user` (see README.md) — is left in
  `FORCE_CHANGE_PASSWORD` with a Cognito-generated temporary password
  nobody knows, which is indistinguishable from "wrong password" to a
  client attempting `USER_SRP_AUTH`; that admin also just needs one OTP
  sign-in + `setMyPassword` to get a real password. Cognito's default
  password policy applies (min. 8 characters, upper/lowercase, a number,
  a symbol) — not customized.
- `Admins` group — **admin is purely group membership on an otherwise
  ordinary phone-based Cognito user**, not a separate account type
  (this was already true conceptually; login unification just extends
  it to the login mechanism itself). Admin mutations (`generateRound`,
  `recordSetResult`, `closeMatchday`, `createMatchday`, `updateMatchday`,
  `createSeason`, `closeSeason`, `createPlayer`, `updatePlayer`,
  `promoteToAdmin`, `demoteFromAdmin`) are restricted with
  `@aws_auth(cognito_groups: ["Admins"])` in the GraphQL schema —
  enforced by AppSync itself. `setMatchdayJoining` and `setMyPassword` are
  the two mutations deliberately *not* schema-restricted — the former
  because any authenticated user needs it for their own RSVP (see the
  Resolver Split section for how it self-enforces the admin-only
  `playerId` argument instead), the latter because it's self-enforced by
  identity rather than schema, per the Password sign-in bullet above.
  Everything else under `Query` is open to any authenticated user by
  default; the one PII field on `Player` (`phone`) is field-gated to
  `Admins` instead. A non-admin caller does resolve that field to `null`
  since it's nullable — but AppSync *also* appends an `Unauthorized` entry to the
  response's top-level `errors` array for each denied field, and
  `web/src/lib/graphqlClient.ts` throws on any `errors` present. So a
  non-admin `listPlayers` call that selects `phone` fails
  outright, not "succeeds with nulls" — the two participant-facing
  pages that need playerId → displayName resolution
  (`SeasonRankingPage`, `MatchdayPage`) call `listPlayerNames` instead
  (`web/src/lib/api.ts`), which selects only `playerId displayName
  createdAt` and so never triggers the field-auth error in the first
  place; `ParticipantsPage`/`MatchdaySetupPage` (admin-only routes)
  keep using `listPlayers`'s full selection. `listAdminPhoneNumbers`
  keeps its own explicit `Admins` restriction since it's
  admin-management UI data.
- **Managing admin status**: an existing admin can promote/demote other
  players via the UI (`promoteToAdmin`/`demoteFromAdmin` — the latter
  refuses to demote the caller themselves, to avoid stranding the UI
  path if there's only one admin). The very first admin, and any
  "break-glass" admin not tied to a `Player` record at all, has to be
  set up via AWS console (`admin-create-user` + `admin-add-user-to-
  group`) — none of the Cognito trigger Lambdas or resolvers require a
  `Player` row to exist, so a bare Cognito user works identically.
  A player who's currently an admin can't have their phone number changed
  via the UI (enforced in `updatePlayer`, not just hidden client-side):
  Cognito `Username` is immutable, so a phone change means delete +
  recreate the Cognito user, which would silently drop group membership
  that doesn't survive the recreation. This is deliberate, not just an
  unsolved edge case — an admin's own phone number staying stable is the
  point (demote first, or use the AWS console, to actually renumber
  one).
- "Switch role" (admin ⇄ participant) is a **frontend-only** concept —
  since admin permissions are a strict superset of participant
  permissions, there's nothing to change on the backend; the client just
  changes which UI it shows.
- Federated social login (Google etc.) remains a theoretical future
  option on the same pool if ever wanted, but isn't the plan — SMS OTP
  covers both admin and participant login now.

## CDK Structure

Two stacks:

- **`PoplaBackendStack`** — Cognito User Pool (+ `Admins` group), the
  DynamoDB tables and GSIs above, the AppSync API (schema, native JS
  resolvers, Lambda resolvers + their Lambda functions and IAM roles).
  Exports the AppSync API URL, API ID, User Pool ID, and User Pool Client
  ID.
- **`PoplaWebStack`** — S3 bucket (private) + CloudFront distribution
  serving the built frontend. Consumes the backend stack's exported
  values as build-time configuration for the frontend bundle.

Splitting this way means a frontend-only change can redeploy
`PoplaWebStack` without touching backend infrastructure, and vice versa.

## CI/CD (GitHub Actions)

- On push to `main`: build the Lambda resolver code and the frontend,
  then `cdk deploy` both stacks in order (`PoplaBackendStack` before
  `PoplaWebStack`, since the web stack needs the backend's outputs).
- AWS authentication via GitHub's OIDC provider assuming a scoped IAM
  role — no long-lived AWS access keys stored as GitHub secrets.

## Open Questions

- Concurrent admins could both create/reopen a season at the same moment
  and end up with two `ACTIVE` seasons — the "only one active season"
  invariant is enforced client-side (disabled buttons) in `SeasonsPage`,
  not at the data layer. Acceptable for a single-admin-at-a-time club
  tool; would need a real check (e.g. a Lambda resolver) if that stops
  being true.
