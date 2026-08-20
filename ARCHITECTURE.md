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
  Cognito auth via `amazon-cognito-identity-js` (SRP, matching the User
  Pool client's `authFlows: { userSrp: true }`), including the
  `newPasswordRequired` challenge admins hit on first sign-in after
  `admin-create-user`.
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
- Attributes: `displayName`, `email` (optional), `cognitoSub` (nullable,
  set once the player has logged in), `createdAt`.
- Persists across seasons — this is the durable identity a matchday
  participant and season standings entry both point back to.

### `Seasons`
- PK: `seasonId`
- Attributes: `name`, `status` (`ACTIVE` | `CLOSED`), `startDate`,
  `closedAt`.

### `Matchdays`
- PK: `matchdayId`
- Attributes: `seasonId`, `date`, `format` (`MEXICANO` | `AMERICANO`),
  `status` (`SETUP` | `IN_PROGRESS` | `CLOSED`).
- GSI `bySeasonId`: PK `seasonId`, SK `date` — list matchdays in a season,
  chronologically.

### `MatchdayParticipants`
- PK: `matchdayId`, SK: `playerId`
- The registered participant list for a matchday. Count must be a
  multiple of 4.

### `Matches`
- PK: `matchdayId`, SK: `ROUND#<n>#COURT#<c>`
- Attributes: `round`, `court`, `team1PlayerIds` (2), `team2PlayerIds`
  (2), `team1Games`, `team2Games`, `status` (`PENDING` | `COMPLETE`).
- One item per set (N/4 courts per round, one or more rounds per
  matchday — see SPEC.md).

### `MatchdayResults`
- PK: `matchdayId`, SK: `playerId`
- Attributes: `setsWon`, `gamesWon`, `gamesLost`, `gameDiff`, `rank`,
  `seasonPoints`, `seasonId` (denormalized for reference).
- Written once, by the `closeMatchday` Lambda, from the completed
  `Matches` for that matchday.
- GSI `byMatchdayRank`: PK `matchdayId`, SK `rankScore` (number) — a
  precomputed `gamesWon * 100000 + (gameDiff + offset)` so a plain
  descending `Query` returns the day ranking (games won desc, then game
  diff desc — see SPEC.md's Day Ranking) directly. No client-side or
  resolver-side sorting needed.

### `SeasonStandings`
- PK: `seasonId`, SK: `playerId`
- Attributes: `totalPoints`, `matchdaysPlayed`.
- Incrementally updated (atomic `ADD`) by `closeMatchday`, in the same
  transaction as the `MatchdayResults` write.
- GSI `bySeasonPoints`: PK `seasonId`, SK `totalPoints` — descending
  `Query` gives the season leaderboard directly, native resolver, no
  Lambda involved on read.

## Resolver Split

**Native (AppSync JS resolvers, direct to DynamoDB):**
- `listPlayers`, `createPlayer`, `updatePlayer` — the latter a dynamic
  partial-update `SET` expression over whichever fields were provided
- `getSeason`, `listSeasons`
- `getMatchday`, `listMatchdaysBySeason`, `listMatchdayParticipantIds`
- `listMatches(matchdayId, round?)`
- `getMatchdayRanking(matchdayId)` — Query on `MatchdayResults.byMatchdayRank`
- `getSeasonStanding(seasonId)` — Query on `SeasonStandings.bySeasonPoints`
- `createSeason`, `closeSeason`, `reopenSeason` — simple state changes.
  Only one `ACTIVE` season at a time is a UI-enforced convention, not a
  data-layer constraint — see Open Questions.
- `createMatchday` — includes participant list; JS resolver validates
  participant count is a non-zero multiple of 4 and the season is `ACTIVE`
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
  batch-writes the `Matches` items for that round. Also flips
  `Matchdays.status` from `SETUP` to `IN_PROGRESS` on round 1, which is
  what makes the matchday stop being editable.
- `closeMatchday(matchdayId)` — aggregates all generated rounds' complete
  `Matches`, computes each player's setsWon/gamesWon/gamesLost/gameDiff/
  rank/seasonPoints, writes `MatchdayResults`, and atomically increments
  `SeasonStandings` in a single DynamoDB transaction. Also flips
  `Matchdays.status` to `CLOSED`. The admin decides when to stop
  generating rounds and call this — there's no fixed round count.
- `updateMatchday(matchdayId, date?, format?, participantIds?)` — only
  allowed while `status == SETUP`. A participant-list change means
  reading the current `MatchdayParticipants`, diffing against the new
  list, and writing the add/remove set in one transaction alongside the
  `Matchdays` update — real enough logic to warrant Lambda over a native
  resolver, unlike `createMatchday`'s simpler "write everything" case.

Note: Mexicano's round-over-round re-ranking (every round after the first
depends on the running standings *within that matchday*, not just the
final `MatchdayResults` which are only written at close) means
`generateRound` computes an in-memory/interim ranking from the completed
`Matches` of prior rounds each time it runs, rather than reading a
persisted "day standings so far" table. This keeps `MatchdayResults` as a
single, unambiguous final-ranking table rather than something written
incrementally.

## Auth

- One Cognito User Pool.
- `Admins` group — phase 1 members created manually (no self-signup).
  Admin mutations (`generateRound`, `recordSetResult`, `closeMatchday`,
  `createMatchday`, `createSeason`, `closeSeason`) are restricted with
  `@aws_auth(cognito_groups: ["Admins"])` in the GraphQL schema — enforced
  by AppSync itself, no application code needed for the check.
- Phase 2: federated identity providers (Google, etc.) added to the same
  User Pool for participant self-signup. New users get no group (i.e.
  read-only participant access to phase-2 features); an admin promotes a
  user into `Admins` when appropriate.
- "Switch role" (admin ⇄ participant) is a **frontend-only** concept —
  since admin permissions are a strict superset of participant
  permissions, there's nothing to change on the backend; the client just
  changes which UI it shows.

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

- Exact streepjes rules — once known, likely an additional attribute on
  `MatchdayResults`/`SeasonStandings` plus a small addition to
  `closeMatchday`'s computation; not expected to change the overall
  architecture.
- Concurrent admins could both create/reopen a season at the same moment
  and end up with two `ACTIVE` seasons — the "only one active season"
  invariant is enforced client-side (disabled buttons) in `SeasonsPage`,
  not at the data layer. Acceptable for a single-admin-at-a-time club
  tool; would need a real check (e.g. a Lambda resolver) if that stops
  being true.
