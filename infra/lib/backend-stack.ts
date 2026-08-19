import * as path from 'path';
import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as lambda from 'aws-cdk-lib/aws-lambda';
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
    });

    const seasonsTable = new dynamodb.Table(this, 'SeasonsTable', {
      tableName: 'PoplaSeasons',
      partitionKey: { name: 'seasonId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const matchdaysTable = new dynamodb.Table(this, 'MatchdaysTable', {
      tableName: 'PoplaMatchdays',
      partitionKey: { name: 'matchdayId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
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
      }
    );

    const matchesTable = new dynamodb.Table(this, 'MatchesTable', {
      tableName: 'PoplaMatches',
      partitionKey: { name: 'matchdayId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'roundCourt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const matchdayResultsTable = new dynamodb.Table(this, 'MatchdayResultsTable', {
      tableName: 'PoplaMatchdayResults',
      partitionKey: { name: 'matchdayId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'playerId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
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
    });
    seasonStandingsTable.addGlobalSecondaryIndex({
      indexName: 'bySeasonPoints',
      partitionKey: { name: 'seasonId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'totalPoints', type: dynamodb.AttributeType.NUMBER },
    });

    // ---- Cognito ----

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'popla-users',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new cognito.CfnUserPoolGroup(this, 'AdminsGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'Admins',
    });

    // Phase 2 will add `oAuth` + `supportedIdentityProviders` here (and
    // corresponding cognito.UserPoolIdentityProvider constructs) for
    // Google/social sign-in, once participant login is built.
    const userPoolClient = userPool.addClient('WebClient', {
      authFlows: { userSrp: true },
    });

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
      { dataSource: playersDS, typeName: 'Mutation', fieldName: 'createPlayer', file: 'Mutation.createPlayer.js' },
      { dataSource: playersDS, typeName: 'Mutation', fieldName: 'updatePlayer', file: 'Mutation.updatePlayer.js' },
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
