import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import type { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface MonitoringConstructProps {
  environment: string;
  alertEmail: string;
  mcpFunction: IFunction;
  portalApiFunction: IFunction;
  mcpApi: HttpApi;
  portalApi: HttpApi;
  webAcl: CfnWebACL;
  usersTable: Table;
  apiKeysTable: Table;
  userMusicTokensTable: Table;
}

export class MonitoringConstruct extends Construct {
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringConstructProps) {
    super(scope, id);

    const env = props.environment;

    // SNS topic for alarms
    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `mixcraft-alerts-${env}`,
      displayName: `MixCraft Alerts (${env})`,
    });

    if (props.alertEmail) {
      this.alertTopic.addSubscription(
        new subscriptions.EmailSubscription(props.alertEmail),
      );
    }

    const alarmAction = new actions.SnsAction(this.alertTopic);

    // --- Lambda alarms ---

    this.createLambdaAlarms('Mcp', props.mcpFunction, alarmAction, env);
    this.createLambdaAlarms('PortalApi', props.portalApiFunction, alarmAction, env);

    // --- API Gateway alarms ---

    this.createApiAlarms('Mcp', props.mcpApi, alarmAction, env);
    this.createApiAlarms('PortalApi', props.portalApi, alarmAction, env);

    // --- WAF alarm ---

    const wafBlockedMetric = new cloudwatch.Metric({
      namespace: 'AWS/WAFV2',
      metricName: 'BlockedRequests',
      dimensionsMap: {
        WebACL: props.webAcl.attrId,
        Region: 'us-east-1',
        Rule: 'ALL',
      },
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    const wafAlarm = wafBlockedMetric.createAlarm(this, 'WafBlockedAlarm', {
      alarmName: `mixcraft-${env}-waf-blocked-spike`,
      alarmDescription: 'WAF blocked >= 50 requests in 5 minutes — possible attack or misconfigured rule',
      threshold: 50,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    wafAlarm.addAlarmAction(alarmAction);

    // --- CloudWatch dashboard ---

    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `MixCraft-${env}`,
    });

    // Row 1: Lambda invocations and errors
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        left: [
          props.mcpFunction.metricInvocations({ label: 'MCP' }),
          props.portalApiFunction.metricInvocations({ label: 'Portal API' }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [
          props.mcpFunction.metricErrors({ label: 'MCP' }),
          props.portalApiFunction.metricErrors({ label: 'Portal API' }),
        ],
        width: 12,
      }),
    );

    // Row 2: Lambda duration and throttles
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration (avg ms)',
        left: [
          props.mcpFunction.metricDuration({ label: 'MCP' }),
          props.portalApiFunction.metricDuration({ label: 'Portal API' }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Throttles',
        left: [
          props.mcpFunction.metricThrottles({ label: 'MCP' }),
          props.portalApiFunction.metricThrottles({ label: 'Portal API' }),
        ],
        width: 12,
      }),
    );

    // Row 3: API Gateway requests and errors
    const mcpApiId = props.mcpApi.httpApiId;
    const portalApiId = props.portalApi.httpApiId;

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Gateway Requests',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Count',
            dimensionsMap: { ApiId: mcpApiId },
            statistic: 'Sum',
            label: 'MCP',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Count',
            dimensionsMap: { ApiId: portalApiId },
            statistic: 'Sum',
            label: 'Portal API',
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway 4xx / 5xx',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '4xx',
            dimensionsMap: { ApiId: mcpApiId },
            statistic: 'Sum',
            label: 'MCP 4xx',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '4xx',
            dimensionsMap: { ApiId: portalApiId },
            statistic: 'Sum',
            label: 'Portal 4xx',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '5xx',
            dimensionsMap: { ApiId: mcpApiId },
            statistic: 'Sum',
            label: 'MCP 5xx',
            color: '#d62728',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '5xx',
            dimensionsMap: { ApiId: portalApiId },
            statistic: 'Sum',
            label: 'Portal 5xx',
            color: '#ff7f0e',
          }),
        ],
        width: 12,
      }),
    );

    // Row 4: WAF and DynamoDB
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'WAF Allowed vs Blocked',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/WAFV2',
            metricName: 'AllowedRequests',
            dimensionsMap: {
              WebACL: props.webAcl.attrId,
              Region: 'us-east-1',
              Rule: 'ALL',
            },
            statistic: 'Sum',
            label: 'Allowed',
          }),
          wafBlockedMetric,
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Consumed Capacity',
        left: [
          props.usersTable.metricConsumedReadCapacityUnits({ label: 'Users Read' }),
          props.apiKeysTable.metricConsumedReadCapacityUnits({ label: 'ApiKeys Read' }),
          props.userMusicTokensTable.metricConsumedReadCapacityUnits({ label: 'Tokens Read' }),
        ],
        right: [
          props.usersTable.metricConsumedWriteCapacityUnits({ label: 'Users Write' }),
          props.apiKeysTable.metricConsumedWriteCapacityUnits({ label: 'ApiKeys Write' }),
          props.userMusicTokensTable.metricConsumedWriteCapacityUnits({ label: 'Tokens Write' }),
        ],
        width: 12,
      }),
    );
  }

  private createLambdaAlarms(
    prefix: string,
    fn: IFunction,
    action: actions.SnsAction,
    env: string,
  ): void {
    const errorAlarm = fn.metricErrors({
      period: Duration.minutes(5),
      statistic: 'Sum',
    }).createAlarm(this, `${prefix}ErrorAlarm`, {
      alarmName: `mixcraft-${env}-${prefix.toLowerCase()}-lambda-errors`,
      alarmDescription: `${prefix} Lambda >= 3 errors in 5 minutes`,
      threshold: 3,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    errorAlarm.addAlarmAction(action);

    const durationAlarm = fn.metricDuration({
      period: Duration.minutes(5),
      statistic: 'Average',
    }).createAlarm(this, `${prefix}DurationAlarm`, {
      alarmName: `mixcraft-${env}-${prefix.toLowerCase()}-lambda-duration`,
      alarmDescription: `${prefix} Lambda avg duration > 15s (timeout is 30s)`,
      threshold: 15_000,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    durationAlarm.addAlarmAction(action);
  }

  private createApiAlarms(
    prefix: string,
    api: HttpApi,
    action: actions.SnsAction,
    env: string,
  ): void {
    const fiveXxAlarm = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5xx',
      dimensionsMap: { ApiId: api.httpApiId },
      statistic: 'Sum',
      period: Duration.minutes(5),
    }).createAlarm(this, `${prefix}5xxAlarm`, {
      alarmName: `mixcraft-${env}-${prefix.toLowerCase()}-api-5xx`,
      alarmDescription: `${prefix} API >= 5 server errors in 5 minutes`,
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    fiveXxAlarm.addAlarmAction(action);
  }
}
