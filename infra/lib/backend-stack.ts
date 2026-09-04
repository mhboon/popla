import * as path from 'path';
import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

const RESOLVERS_DIR = path.join(__dirname, '../graphql/resolvers');
const JS_RUNTIME = appsync.FunctionRuntime.JS_1_0_0;

export class PoplaBackendStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ---- DynamoDB tables ----
    // Table names are fixed (not account/region-derived) so they can be
    // referenced literally from resolver/lambda code without injecting
    // anything account-specific.

    const playersTable = new dynamodb.Table(this, 'PlayersTable', {
      tableName: 'PoplaPlayers',
      partitionKey: { name: 'playerId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    const seasonsTable = new dynamodb.Table(this, 'SeasonsTable', {
      tableName: 'PoplaSeasons',
      partitionKey: { name: 'seasonId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    const matchdaysTable = new dynamodb.Table(this, 'MatchdaysTable', {
      tableName: 'PoplaMatchdays',
      partitionKey: { name: 'matchdayId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    matchdaysTable.addGlobalSecondaryIndex({
      indexName: 'bySeasonId',
      partitionKey: { name: 'seasonId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
    });

    const matchdayParticipantsTable = new dynamodb.Table(
      this,
      'MatchdayParticipantsTable',
      {
        tableName: 'PoplaMatchdayParticipants',
        partitionKey: { name: 'matchdayId', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'playerId', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.RETAIN,
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      }
    );

    const matchesTable = new dynamodb.Table(this, 'MatchesTable', {
      tableName: 'PoplaMatches',
      partitionKey: { name: 'matchdayId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'roundCourt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    const matchdayResultsTable = new dynamodb.Table(this, 'MatchdayResultsTable', {
      tableName: 'PoplaMatchdayResults',
      partitionKey: { name: 'matchdayId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'playerId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    matchdayResultsTable.addGlobalSecondaryIndex({
      indexName: 'byMatchdayRank',
      partitionKey: { name: 'matchdayId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'rankScore', type: dynamodb.AttributeType.NUMBER },
    });

    const seasonStandingsTable = new dynamodb.Table(this, 'SeasonStandingsTable', {
      tableName: 'PoplaSeasonStandings',
      partitionKey: { name: 'seasonId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'playerId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    seasonStandingsTable.addGlobalSecondaryIndex({
      indexName: 'bySeasonPoints',
      partitionKey: { name: 'seasonId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'totalPoints', type: dynamodb.AttributeType.NUMBER },
    });
    seasonStandingsTable.addGlobalSecondaryIndex({
      indexName: 'bySeasonWinnerPoints',
      partitionKey: { name: 'seasonId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'winnerPoints', type: dynamodb.AttributeType.NUMBER },
    });

    // Stores the current OTP code + per-phone SMS send-rate state for the
    // CUSTOM_AUTH challenge Lambdas below (create-auth-challenge reads/
    // writes it; nothing else touches it). TTL'd well past the rate
    // window so stale rows clean themselves up.
    const otpChallengesTable = new dynamodb.Table(this, 'OtpChallengesTable', {
      tableName: 'PoplaOtpChallenges',
      partitionKey: { name: 'phone', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // ---- Cognito ----

    // Construct ID is 'UserPoolV2', not 'UserPool': switching
    // signInAliases below changes UsernameAttributes -> AliasAttributes,
    // which Cognito's API refuses to update in place ("Updates are not
    // allowed for property - AliasAttributes") — CloudFormation doesn't
    // mark this as a replacement-triggering property change on its own,
    // it just attempts an UpdateUserPool call that Cognito then rejects,
    // failing the whole stack update. Renaming the construct forces CDK
    // to emit a new logical ID, so CloudFormation creates a fresh pool
    // and detaches (not deletes, per removalPolicy below) the old one
    // instead of trying to mutate it.
    const userPool = new cognito.UserPool(this, 'UserPoolV2', {
      userPoolName: 'popla-users',
      selfSignUpEnabled: false,
      // `username: true` alongside `email: true` puts Cognito in
      // AliasAttributes mode instead of UsernameAttributes mode — that's
      // what lets admin-create-user set a real, friendly Username
      // instead of Cognito silently generating a random GUID and only
      // accepting email as the sign-in alias. This is immutable on an
      // existing pool (changing it replaces the pool), so existing users
      // need recreating after this deploys — see README.md.
      signInAliases: { username: true, email: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new cognito.CfnUserPoolGroup(this, 'AdminsGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'Admins',
    });

    // Passwordless SMS-OTP login for everyone — admins and participants
    // alike (see ARCHITECTURE.md's Auth section). Every Cognito user in
    // this pool, admin or not, is created with Username = their E.164
    // phone number; `custom: true` enables the CUSTOM_AUTH flow that the
    // three challenge Lambdas below implement.
    // preventUserExistenceErrors masks "phone not registered" vs "wrong
    // code" so the app can't be used to enumerate registered numbers —
    // the challenge Lambdas below handle the resulting
    // `userNotFound: true` branch explicitly.
    const userPoolClient = userPool.addClient('WebClient', {
      authFlows: { custom: true },
      preventUserExistenceErrors: true,
      // Matches CDK's own default; set explicitly for documentation —
      // long enough that a participant isn't re-verifying by SMS on
      // every visit, given the AuthContext silent-refresh loop.
      refreshTokenValidity: Duration.days(30),
    });

    // ---- Cognito CUSTOM_AUTH challenge Lambdas (SMS OTP) ----

    const defineAuthChallengeFn = new NodejsFunction(this, 'DefineAuthChallengeFn', {
      entry: path.join(__dirname, '../lambda/define-auth-challenge/index.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(5),
    });

    const createAuthChallengeFn = new NodejsFunction(this, 'CreateAuthChallengeFn', {
      entry: path.join(__dirname, '../lambda/create-auth-challenge/index.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: { OTP_CHALLENGES_TABLE: otpChallengesTable.tableName },
    });
    otpChallengesTable.grantReadWriteData(createAuthChallengeFn);
    // Direct-to-phone-number SNS Publish can't be scoped tighter than '*'.
    createAuthChallengeFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['sns:Publish'], resources: ['*'] })
    );

    const verifyAuthChallengeResponseFn = new NodejsFunction(
      this,
      'VerifyAuthChallengeResponseFn',
      {
        entry: path.join(__dirname, '../lambda/verify-auth-challenge-response/index.ts'),
        runtime: lambda.Runtime.NODEJS_22_X,
        timeout: Duration.seconds(5),
      }
    );

    // addTrigger auto-grants Cognito permission to invoke each function —
    // no manual resource policy needed.
    userPool.addTrigger(cognito.UserPoolOperation.DEFINE_AUTH_CHALLENGE, defineAuthChallengeFn);
    userPool.addTrigger(cognito.UserPoolOperation.CREATE_AUTH_CHALLENGE, createAuthChallengeFn);
    userPool.addTrigger(
      cognito.UserPoolOperation.VERIFY_AUTH_CHALLENGE_RESPONSE,
      verifyAuthChallengeResponseFn
    );

    // ---- AppSync ----

    const api = new appsync.GraphqlApi(this, 'Api', {
      name: 'popla-api',
      definition: appsync.Definition.fromFile(
        path.join(__dirname, '../graphql/schema.graphql')
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: { userPool },
        },
      },
      logConfig: { fieldLogLevel: appsync.FieldLogLevel.ERROR },
    });

    // ---- Native (DynamoDB) resolvers ----

    const playersDS = api.addDynamoDbDataSource('PlayersDataSource', playersTable);
    const seasonsDS = api.addDynamoDbDataSource('SeasonsDataSource', seasonsTable);
    const matchdaysDS = api.addDynamoDbDataSource(
      'MatchdaysDataSource',
      matchdaysTable
    );
    const matchesDS = api.addDynamoDbDataSource('MatchesDataSource', matchesTable);
    const resultsDS = api.addDynamoDbDataSource(
      'ResultsDataSource',
      matchdayResultsTable
    );
    const standingsDS = api.addDynamoDbDataSource(
      'StandingsDataSource',
      seasonStandingsTable
    );
    const matchdayParticipantsDS = api.addDynamoDbDataSource(
      'MatchdayParticipantsDataSource',
      matchdayParticipantsTable
    );

    // createMatchday native-transacts across Matchdays + MatchdayParticipants,
    // so its data source needs write access to both tables.
    matchdayParticipantsTable.grantReadWriteData(matchdaysDS);

    const nativeResolvers: Array<{
      dataSource: appsync.DynamoDbDataSource;
      typeName: string;
      fieldName: string;
      file: string;
    }> = [
      { dataSource: playersDS, typeName: 'Query', fieldName: 'listPlayers', file: 'Query.listPlayers.js' },
      { dataSource: seasonsDS, typeName: 'Query', fieldName: 'listSeasons', file: 'Query.listSeasons.js' },
      { dataSource: seasonsDS, typeName: 'Query', fieldName: 'getSeason', file: 'Query.getSeason.js' },
      { dataSource: seasonsDS, typeName: 'Mutation', fieldName: 'createSeason', file: 'Mutation.createSeason.js' },
      { dataSource: seasonsDS, typeName: 'Mutation', fieldName: 'closeSeason', file: 'Mutation.closeSeason.js' },
      { dataSource: seasonsDS, typeName: 'Mutation', fieldName: 'reopenSeason', file: 'Mutation.reopenSeason.js' },
      { dataSource: matchdaysDS, typeName: 'Query', fieldName: 'getMatchday', file: 'Query.getMatchday.js' },
      { dataSource: matchdayParticipantsDS, typeName: 'Query', fieldName: 'listMatchdayParticipantIds', file: 'Query.listMatchdayParticipantIds.js' },
      { dataSource: matchdaysDS, typeName: 'Query', fieldName: 'listMatchdaysBySeason', file: 'Query.listMatchdaysBySeason.js' },
      { dataSource: matchdaysDS, typeName: 'Mutation', fieldName: 'createMatchday', file: 'Mutation.createMatchday.js' },
      { dataSource: matchesDS, typeName: 'Query', fieldName: 'listMatches', file: 'Query.listMatches.js' },
      { dataSource: matchesDS, typeName: 'Mutation', fieldName: 'recordSetResult', file: 'Mutation.recordSetResult.js' },
      { dataSource: resultsDS, typeName: 'Query', fieldName: 'getMatchdayRanking', file: 'Query.getMatchdayRanking.js' },
      { dataSource: standingsDS, typeName: 'Query', fieldName: 'getSeasonStanding', file: 'Query.getSeasonStanding.js' },
      { dataSource: standingsDS, typeName: 'Query', fieldName: 'getSeasonWinnerRanking', file: 'Query.getSeasonWinnerRanking.js' },
    ];

    for (const { dataSource, typeName, fieldName, file } of nativeResolvers) {
      dataSource.createResolver(`${typeName}${fieldName}Resolver`, {
        typeName,
        fieldName,
        runtime: JS_RUNTIME,
        code: appsync.Code.fromAsset(path.join(RESOLVERS_DIR, file)),
      });
    }

    // ---- Lambda resolvers (real business logic) ----

    const lambdaEnv = {
      MATCHDAYS_TABLE: matchdaysTable.tableName,
      MATCHDAY_PARTICIPANTS_TABLE: matchdayParticipantsTable.tableName,
      MATCHES_TABLE: matchesTable.tableName,
      MATCHDAY_RESULTS_TABLE: matchdayResultsTable.tableName,
      SEASON_STANDINGS_TABLE: seasonStandingsTable.tableName,
    };

    const generateRoundFn = new NodejsFunction(this, 'GenerateRoundFn', {
      entry: path.join(__dirname, '../lambda/generate-round/index.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: lambdaEnv,
    });
    // Read-write: also flips status SETUP -> IN_PROGRESS when round 1 is
    // generated (see infra/lambda/generate-round/index.ts).
    matchdaysTable.grantReadWriteData(generateRoundFn);
    matchdayParticipantsTable.grantReadData(generateRoundFn);
    matchesTable.grantReadWriteData(generateRoundFn);

    const closeMatchdayFn = new NodejsFunction(this, 'CloseMatchdayFn', {
      entry: path.join(__dirname, '../lambda/close-matchday/index.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: lambdaEnv,
    });
    matchdaysTable.grantReadWriteData(closeMatchdayFn);
    matchesTable.grantReadData(closeMatchdayFn);
    matchdayResultsTable.grantWriteData(closeMatchdayFn);
    seasonStandingsTable.grantReadWriteData(closeMatchdayFn);

    const generateRoundDS = api.addLambdaDataSource(
      'GenerateRoundDataSource',
      generateRoundFn
    );
    generateRoundDS.createResolver('MutationGenerateRoundResolver', {
      typeName: 'Mutation',
      fieldName: 'generateRound',
      runtime: JS_RUNTIME,
      code: appsync.Code.fromAsset(
        path.join(RESOLVERS_DIR, 'Mutation.generateRound.js')
      ),
    });

    const closeMatchdayDS = api.addLambdaDataSource(
      'CloseMatchdayDataSource',
      closeMatchdayFn
    );
    closeMatchdayDS.createResolver('MutationCloseMatchdayResolver', {
      typeName: 'Mutation',
      fieldName: 'closeMatchday',
      runtime: JS_RUNTIME,
      code: appsync.Code.fromAsset(
        path.join(RESOLVERS_DIR, 'Mutation.closeMatchday.js')
      ),
    });

    const updateMatchdayFn = new NodejsFunction(this, 'UpdateMatchdayFn', {
      entry: path.join(__dirname, '../lambda/update-matchday/index.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: lambdaEnv,
    });
    matchdaysTable.grantReadWriteData(updateMatchdayFn);
    matchdayParticipantsTable.grantReadWriteData(updateMatchdayFn);

    const updateMatchdayDS = api.addLambdaDataSource(
      'UpdateMatchdayDataSource',
      updateMatchdayFn
    );
    updateMatchdayDS.createResolver('MutationUpdateMatchdayResolver', {
      typeName: 'Mutation',
      fieldName: 'updateMatchday',
      runtime: JS_RUNTIME,
      code: appsync.Code.fromAsset(
        path.join(RESOLVERS_DIR, 'Mutation.updateMatchday.js')
      ),
    });

    // ---- Player provisioning + admin management Lambda resolvers ----
    // createPlayer/updatePlayer/promoteToAdmin/demoteFromAdmin/
    // listAdminPhoneNumbers all provision or inspect Cognito state
    // (AdminCreateUser/AdminDeleteUser/AdminAddUserToGroup/
    // AdminRemoveUserFromGroup/AdminListGroupsForUser/ListUsersInGroup),
    // which is real logic beyond a DynamoDB write — see
    // ARCHITECTURE.md's Auth section.

    const playerAuthEnv = {
      PLAYERS_TABLE: playersTable.tableName,
      USER_POOL_ID: userPool.userPoolId,
    };

    const createPlayerFn = new NodejsFunction(this, 'CreatePlayerFn', {
      entry: path.join(__dirname, '../lambda/create-player/index.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: playerAuthEnv,
    });
    playersTable.grantReadWriteData(createPlayerFn);
    createPlayerFn.addToRolePolicy(
      new iam.PolicyStatement({
        // AdminSetUserPassword moves the new user out of
        // FORCE_CHANGE_PASSWORD — see infra/lambda/shared/cognito.ts.
        actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminSetUserPassword'],
        resources: [userPool.userPoolArn],
      })
    );

    const createPlayerDS = api.addLambdaDataSource('CreatePlayerDataSource', createPlayerFn);
    // Logical ID must exactly match the old native resolver's
    // (`${typeName}${fieldName}Resolver` from the nativeResolvers loop,
    // i.e. lowercase-first-letter 'create...') — createResolver() always
    // scopes under the shared `api` construct regardless of which data
    // source it's called on, so this ID is what CloudFormation actually
    // keys the resolver's identity on. A different ID here reads as a
    // brand-new AWS::AppSync::Resolver to CloudFormation, which then
    // collides with the still-live old one at deploy time (AppSync only
    // allows one resolver per type+field) instead of just updating its
    // dataSourceName/code in place.
    createPlayerDS.createResolver('MutationcreatePlayerResolver', {
      typeName: 'Mutation',
      fieldName: 'createPlayer',
      runtime: JS_RUNTIME,
      code: appsync.Code.fromAsset(path.join(RESOLVERS_DIR, 'Mutation.createPlayer.js')),
    });

    const updatePlayerFn = new NodejsFunction(this, 'UpdatePlayerFn', {
      entry: path.join(__dirname, '../lambda/update-player/index.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: playerAuthEnv,
    });
    playersTable.grantReadWriteData(updatePlayerFn);
    updatePlayerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminListGroupsForUser',
        ],
        resources: [userPool.userPoolArn],
      })
    );

    const updatePlayerDS = api.addLambdaDataSource('UpdatePlayerDataSource', updatePlayerFn);
    // Same logical-ID-must-match reasoning as createPlayer's resolver above.
    updatePlayerDS.createResolver('MutationupdatePlayerResolver', {
      typeName: 'Mutation',
      fieldName: 'updatePlayer',
      runtime: JS_RUNTIME,
      code: appsync.Code.fromAsset(path.join(RESOLVERS_DIR, 'Mutation.updatePlayer.js')),
    });

    const promoteAdminFn = new NodejsFunction(this, 'PromoteAdminFn', {
      entry: path.join(__dirname, '../lambda/promote-admin/index.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: playerAuthEnv,
    });
    playersTable.grantReadData(promoteAdminFn);
    promoteAdminFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminAddUserToGroup'],
        resources: [userPool.userPoolArn],
      })
    );

    const promoteAdminDS = api.addLambdaDataSource('PromoteAdminDataSource', promoteAdminFn);
    promoteAdminDS.createResolver('MutationPromoteToAdminResolver', {
      typeName: 'Mutation',
      fieldName: 'promoteToAdmin',
      runtime: JS_RUNTIME,
      code: appsync.Code.fromAsset(path.join(RESOLVERS_DIR, 'Mutation.promoteToAdmin.js')),
    });

    const demoteAdminFn = new NodejsFunction(this, 'DemoteAdminFn', {
      entry: path.join(__dirname, '../lambda/demote-admin/index.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: playerAuthEnv,
    });
    playersTable.grantReadData(demoteAdminFn);
    demoteAdminFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminRemoveUserFromGroup'],
        resources: [userPool.userPoolArn],
      })
    );

    const demoteAdminDS = api.addLambdaDataSource('DemoteAdminDataSource', demoteAdminFn);
    demoteAdminDS.createResolver('MutationDemoteFromAdminResolver', {
      typeName: 'Mutation',
      fieldName: 'demoteFromAdmin',
      runtime: JS_RUNTIME,
      code: appsync.Code.fromAsset(path.join(RESOLVERS_DIR, 'Mutation.demoteFromAdmin.js')),
    });

    const listAdminsFn = new NodejsFunction(this, 'ListAdminsFn', {
      entry: path.join(__dirname, '../lambda/list-admins/index.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: { USER_POOL_ID: userPool.userPoolId },
    });
    listAdminsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:ListUsersInGroup'],
        resources: [userPool.userPoolArn],
      })
    );

    const listAdminsDS = api.addLambdaDataSource('ListAdminsDataSource', listAdminsFn);
    listAdminsDS.createResolver('QueryListAdminPhoneNumbersResolver', {
      typeName: 'Query',
      fieldName: 'listAdminPhoneNumbers',
      runtime: JS_RUNTIME,
      code: appsync.Code.fromAsset(path.join(RESOLVERS_DIR, 'Query.listAdminPhoneNumbers.js')),
    });

    // ---- Outputs ----
    // None of these are account-specific (API URL is
    // <id>.appsync-api.<region>.amazonaws.com, pool IDs are
    // <region>_<random>) so they're safe to print in CI logs.

    new CfnOutput(this, 'ApiUrl', { value: api.graphqlUrl });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
    });
  }
}
