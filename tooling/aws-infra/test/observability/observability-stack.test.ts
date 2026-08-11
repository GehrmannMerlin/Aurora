import { describe, expect, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { resolveEnvironmentConfig } from '../../src/config.js';
import { NetworkStack } from '../../src/stacks/network-stack.js';
import { ComputeStack } from '../../src/stacks/compute-stack.js';
import { DataStack } from '../../src/stacks/data-stack.js';
import { ObservabilityStack } from '../../src/stacks/observability-stack.js';
import { OPERATIONAL_ALERT_RULES } from '../../src/observability/alert-rules.js';

function observabilityTemplate(envName: 'staging' | 'production') {
  const app = new App();
  const env = resolveEnvironmentConfig(envName);
  const network = new NetworkStack(app, `Network${envName}`, { env });
  const compute = new ComputeStack(app, `Compute${envName}`, {
    env,
    vpc: network.vpc,
    serviceSecurityGroup: network.serviceSecurityGroup,
  });
  const data = new DataStack(app, `Data${envName}`, {
    env,
    vpc: network.vpc,
    databaseSecurityGroup: network.databaseSecurityGroup,
  });
  const observability = new ObservabilityStack(app, `Observability${envName}`, {
    env,
    services: compute.services,
    logGroups: compute.logGroups,
    database: data.database,
  });
  return Template.fromStack(observability);
}

describe('OPS-06 observability stack', () => {
  it('creates a CloudWatch dashboard, an SNS alert topic and a Logs metric filter', () => {
    const template = observabilityTemplate('production');
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
    template.resourceCountIs('AWS::SNS::Topic', 1);
    template.resourceCountIs('AWS::Logs::MetricFilter', 1);
  });

  it('wires an alarm for every operational alert rule, routed to SNS', () => {
    const template = observabilityTemplate('production');
    const alarms = Object.values(
      template.findResources('AWS::CloudWatch::Alarm'),
    ) as unknown as readonly {
      readonly Properties?: {
        readonly AlarmName?: string;
        readonly AlarmActions?: readonly string[];
      };
    }[];
    expect(alarms.length).toBe(OPERATIONAL_ALERT_RULES.length);
    for (const alarm of alarms) {
      expect(alarm.Properties?.AlarmActions).toBeDefined();
      expect(alarm.Properties?.AlarmActions?.length).toBeGreaterThan(0);
    }
  });

  it('keeps a P0 alarm for deployment failures with a runbook reference', () => {
    const template = observabilityTemplate('production');
    const alarm = Object.values(
      template.findResources('AWS::CloudWatch::Alarm'),
    ) as unknown as readonly {
      readonly Properties?: { readonly AlarmName?: string; readonly AlarmDescription?: string };
    }[];
    const deployment = alarm.find((candidate) =>
      candidate.Properties?.AlarmName?.includes('ops-deployment-failure'),
    );
    expect(deployment).toBeDefined();
    expect(deployment?.Properties?.AlarmDescription).toContain('worker-and-deployment-failure.md');
  });

  it('creates no product-alert resources (DAT-19 is out of scope)', () => {
    const template = observabilityTemplate('production');
    const raw = JSON.stringify(template.toJSON());
    expect(raw).not.toContain('productAlert');
    expect(raw).not.toContain('issue-spike');
  });

  it('contains no secrets in dashboard/alarm text', () => {
    const template = observabilityTemplate('production');
    const raw = JSON.stringify(template.toJSON());
    for (const forbidden of ['AKIA', 'BEGIN PRIVATE KEY', 'password=', 'aurora_ingest_']) {
      expect(raw).not.toContain(forbidden);
    }
  });
});
