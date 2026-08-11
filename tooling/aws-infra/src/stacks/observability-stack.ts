import {
  aws_cloudwatch as cloudwatch,
  aws_logs as logs,
  aws_sns as sns,
  Duration,
  Stack,
  Tags,
} from 'aws-cdk-lib';
import type { aws_ecs as ecs, aws_rds as rds } from 'aws-cdk-lib';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config.js';
import { resourceName, standardTags } from '../naming.js';
import { OPERATIONAL_ALERT_RULES } from '../observability/alert-rules.js';
import { OPERATIONAL_NAMESPACE } from '../observability/metrics-contract.js';

export interface ObservabilityStackProps {
  readonly env: EnvironmentConfig;
  readonly services: Readonly<Record<string, ecs.FargateService>>;
  readonly logGroups: Readonly<Record<string, logs.ILogGroup>>;
  readonly database: rds.DatabaseInstance;
}

const INGESTION_LOGS_NAMESPACE = 'Aurora/Ingestion';

function comparisonOperator(operator: string): cloudwatch.ComparisonOperator {
  switch (operator) {
    case 'GreaterThanThreshold':
      return cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD;
    case 'GreaterThanOrEqualToThreshold':
      return cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;
    case 'LessThanThreshold':
      return cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD;
    case 'LessThanOrEqualToThreshold':
      return cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD;
    default:
      throw new Error(`ops_alarm_invalid_operator: ${operator}`);
  }
}

const RDS_METRIC_NAMES: Readonly<Record<string, string>> = {
  'DB.CPUUtilization': 'CPUUtilization',
  'DB.FreeStorageBytes': 'FreeStorageSpace',
  'DB.Connections': 'DatabaseConnections',
};

/**
 * OPS-06 observability wiring (Backend Design §14; 测试/部署设计 §12).
 *
 * CloudWatch dashboard + Logs metric filter + operational alarms + SNS routing,
 * all referenced from the frozen `OPERATIONAL_ALERT_RULES` contract. Wiring is
 * honest about metric sources:
 *
 * - native signals (RDS CPU/storage/connections, ECS running task count) are
 *   wired to real resources that exist in this IaC;
 * - `Aurora/Ingestion/ErrorCount` comes from a Logs metric filter over the
 *   ingestion-api log group;
 * - `Aurora/Operational` custom metrics (Processing.*, Worker.*,
 *   Deployment.*, Ingestion.Availability) are declared `requires-app-emitter`:
 *   alarms use `treatMissingData=notBreaching` so an un-emitted metric never
 *   false-positives before the app emits it.
 *
 * Product alerts (DAT-19) are out of scope; no rule in OPERATIONAL_ALERT_RULES
 * carries productAlert, and no product-alert resource is created here.
 */
export class ObservabilityStack extends Stack {
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly alarms: Readonly<Record<string, cloudwatch.Alarm>>;
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    const { env, services, logGroups, database } = props;
    super(scope, id, { env: { account: env.account, region: env.region } });

    this.alarmTopic = new sns.Topic(this, 'OpsAlertTopic', {
      topicName: resourceName(env, 'sns', 'ops-alerts'),
    });

    const ingestionApiLogGroup = logGroups['ingestion-api'];
    if (ingestionApiLogGroup === undefined) {
      throw new Error('obs_stack_internal: missing ingestion-api log group');
    }
    new logs.MetricFilter(this, 'IngestionErrorFilter', {
      logGroup: ingestionApiLogGroup,
      metricNamespace: INGESTION_LOGS_NAMESPACE,
      metricName: 'ErrorCount',
      filterPattern: logs.FilterPattern.literal('"level":"error"'),
      metricValue: '1',
    });

    const alarms: Record<string, cloudwatch.Alarm> = {};
    for (const rule of OPERATIONAL_ALERT_RULES) {
      const metric = resolveMetric(rule.metric, rule.statistic, rule.periodSeconds, {
        env,
        services,
        database,
      });
      const alarm = new cloudwatch.Alarm(this, `Alarm${toPascal(rule.id)}`, {
        alarmName: resourceName(env, 'alarm', rule.id),
        alarmDescription: `${rule.title} [${rule.severity}] runbook: ${rule.runbook}; metric: ${rule.metric}`,
        metric,
        threshold: rule.threshold,
        comparisonOperator: comparisonOperator(rule.comparisonOperator),
        evaluationPeriods: rule.evaluationPeriods,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        actionsEnabled: true,
      });
      alarm.addAlarmAction(new SnsAction(this.alarmTopic));
      alarms[rule.id] = alarm;
    }
    this.alarms = alarms;

    const apiService = services['ingestion-api'];
    const workerService = services['ingestion-worker'];
    const textWidget = new cloudwatch.TextWidget({
      markdown:
        `### Aurora ${env.name} operational dashboard\n\n` +
        `SLO: ingestion 99.9% / processing 95%·60s, 99%·5min (requires-benchmark).\n` +
        `Metric sources: ECS/RDS native, Aurora/Ingestion (Logs filter), ` +
        `Aurora/Operational custom (requires-app-emitter).\n` +
        `Provisioning evidence pending; do not interpret as production capacity.`,
      width: 24,
      height: 3,
    }) as cloudwatch.IWidget;

    const dashboards: cloudwatch.IWidget[] = [textWidget];
    if (apiService !== undefined) {
      dashboards.push(
        new cloudwatch.GraphWidget({
          title: 'ingestion-api (ECS)',
          left: [
            apiService.metricCpuUtilization(),
            apiService.metricMemoryUtilization(),
            apiService.metric('RunningTaskCount'),
          ],
          period: Duration.minutes(5),
          width: 12,
          height: 6,
        }) as cloudwatch.IWidget,
      );
    }
    if (workerService !== undefined) {
      dashboards.push(
        new cloudwatch.GraphWidget({
          title: 'ingestion-worker (ECS)',
          left: [
            workerService.metricCpuUtilization(),
            workerService.metricMemoryUtilization(),
            workerService.metric('RunningTaskCount'),
          ],
          period: Duration.minutes(5),
          width: 12,
          height: 6,
        }) as cloudwatch.IWidget,
      );
    }
    dashboards.push(
      new cloudwatch.GraphWidget({
        title: 'PostgreSQL (RDS)',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'CPUUtilization',
            dimensionsMap: { DBInstanceIdentifier: database.instanceIdentifier },
            statistic: 'Average',
            period: Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'DatabaseConnections',
            dimensionsMap: { DBInstanceIdentifier: database.instanceIdentifier },
            statistic: 'Average',
            period: Duration.minutes(5),
          }),
        ],
        period: Duration.minutes(5),
        width: 12,
        height: 6,
      }) as cloudwatch.IWidget,
      new cloudwatch.GraphWidget({
        title: 'processing chain (requires-app-emitter)',
        left: [
          new cloudwatch.Metric({
            namespace: OPERATIONAL_NAMESPACE,
            metricName: 'Processing.LagSeconds',
            dimensionsMap: { environment: env.name },
            statistic: 'Maximum',
            period: Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: OPERATIONAL_NAMESPACE,
            metricName: 'Processing.DeadLettered',
            dimensionsMap: { environment: env.name },
            statistic: 'Sum',
            period: Duration.minutes(5),
          }),
        ],
        period: Duration.minutes(5),
        width: 12,
        height: 6,
      }) as cloudwatch.IWidget,
    );

    this.dashboard = new cloudwatch.Dashboard(this, 'OpsDashboard', {
      dashboardName: resourceName(env, 'dashboard', 'ops'),
    });
    this.dashboard.addWidgets(...dashboards);

    for (const [key, value] of Object.entries(standardTags(env))) {
      Tags.of(this).add(key, value);
    }
  }
}

function resolveMetric(
  metricName: string,
  statistic: string,
  periodSeconds: number,
  ctx: {
    env: EnvironmentConfig;
    services: Readonly<Record<string, ecs.FargateService>>;
    database: rds.DatabaseInstance;
  },
): cloudwatch.Metric {
  const period = Duration.seconds(periodSeconds);
  if (metricName === 'ECS.RunningTaskCount') {
    const worker = ctx.services['ingestion-worker'];
    if (worker === undefined)
      throw new Error('obs_stack_internal: missing ingestion-worker service');
    return worker.metric('RunningTaskCount').with({ statistic, period });
  }
  if (metricName.startsWith('DB.')) {
    const nativeName = RDS_METRIC_NAMES[metricName];
    if (nativeName === undefined) throw new Error(`obs_stack_invalid_db_metric: ${metricName}`);
    return new cloudwatch.Metric({
      namespace: 'AWS/RDS',
      metricName: nativeName,
      dimensionsMap: { DBInstanceIdentifier: ctx.database.instanceIdentifier },
      statistic,
      period,
    });
  }
  const namespace =
    metricName === 'Aurora/Ingestion/ErrorCount' ? INGESTION_LOGS_NAMESPACE : OPERATIONAL_NAMESPACE;
  if (metricName === 'Aurora/Ingestion/ErrorCount') {
    return new cloudwatch.Metric({
      namespace,
      metricName: 'ErrorCount',
      statistic,
      period,
    });
  }
  return new cloudwatch.Metric({
    namespace,
    metricName,
    dimensionsMap: { environment: ctx.env.name },
    statistic,
    period,
  });
}

function toPascal(id: string): string {
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
