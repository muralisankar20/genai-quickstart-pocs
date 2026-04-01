import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { GlueConstruct } from '../lib/glue-construct';

function createStack() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');
  const construct = new GlueConstruct(stack, 'Glue', {
    sourceBucketName: 'test-bucket',
    sourceBucketPrefix: 'data/',
    dataFormat: 'CSV',
    crawlerSchedule: 'cron(0 2 * * ? *)',
  });
  return { stack, construct };
}

describe('GlueConstruct', () => {
  test('creates Glue database with correct name', () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Glue::Database', {
      DatabaseInput: { Name: 'kiro-user-dashboard-db' },
    });
  });

  test('creates crawler targeting correct S3 path', () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Glue::Crawler', {
      Targets: {
        S3Targets: [{ Path: 's3://test-bucket/data/' }],
      },
    });
  });

  test('crawler schema change policy is LOG (not UPDATE)', () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Glue::Crawler', {
      SchemaChangePolicy: {
        UpdateBehavior: 'LOG',
        DeleteBehavior: 'LOG',
      },
    });
  });

  test('crawler IAM role has S3 read permissions', () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [{
          Effect: 'Allow',
          Action: ['s3:GetObject', 's3:ListBucket'],
        }],
      },
    });
  });

  test('exports databaseName and tableName', () => {
    const { construct } = createStack();
    expect(construct.databaseName).toBe('kiro-user-dashboard-db');
    expect(construct.tableName).toBe('data');
  });
});
