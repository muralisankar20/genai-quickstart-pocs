import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DashboardStack } from '../lib/dashboard-stack';

function createStack(overrides?: Partial<{ crawlerSchedule: string; queryMode: 'DirectQuery' | 'SPICE' }>) {
  const app = new cdk.App({ context: { quickSightUserArn: 'arn:aws:quicksight:us-east-1:123456789012:user/default/testuser' } });
  const stack = new DashboardStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    sourceBucketName: 'test-bucket',
    sourceBucketPrefix: 'data/',
    dataFormat: 'CSV',
    ...overrides,
  });
  return { app, stack };
}

describe('DashboardStack', () => {
  test('creates Glue and Athena constructs', () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::Glue::Database', 1);
    template.resourceCountIs('AWS::Glue::Crawler', 1);
    template.resourceCountIs('AWS::Athena::WorkGroup', 1);
    template.resourceCountIs('AWS::S3::Bucket', 1);
  });

  test('has all expected CloudFormation outputs', () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    template.hasOutput('DashboardId', {});
    template.hasOutput('DataSourceId', {});
    template.hasOutput('DatasetId', {});
    template.hasOutput('GlueDatabaseName', {});
    template.hasOutput('GlueTableName', {});
    template.hasOutput('AthenaWorkgroupName', {});
  });

  test('applies default crawler schedule when not provided', () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'cron(30 1 * * ? *)',
    });
  });

  test('uses custom crawler schedule when provided', () => {
    const { stack } = createStack({ crawlerSchedule: 'cron(0 3 * * ? *)' });
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'cron(0 3 * * ? *)',
    });
  });

  test('crawler targets correct S3 path from props', () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Glue::Crawler', {
      Targets: {
        S3Targets: [{ Path: 's3://test-bucket/data/' }],
      },
    });
  });
});
