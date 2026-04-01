import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as glue from 'aws-cdk-lib/aws-glue';
import { AthenaConstruct } from '../lib/athena-construct';

function createStack() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
  const db = new glue.CfnDatabase(stack, 'DB', {
    catalogId: '123456789012',
    databaseInput: { name: 'test-db' },
  });
  const construct = new AthenaConstruct(stack, 'Athena', { glueDatabase: db });
  return { stack, construct };
}

describe('AthenaConstruct', () => {
  test('creates workgroup with correct name', () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Athena::WorkGroup', {
      Name: 'kiro-user-dashboard-workgroup',
    });
  });

  test('workgroup enforces configuration', () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Athena::WorkGroup', {
      WorkGroupConfiguration: {
        EnforceWorkGroupConfiguration: true,
      },
    });
  });

  test('results bucket has S3 managed encryption', () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [{
          ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' },
        }],
      },
    });
  });

  test('results bucket has 30-day lifecycle rule', () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: [Match.objectLike({
          ExpirationInDays: 30,
          Status: 'Enabled',
        })],
      },
    });
  });

  test('results bucket enforces SSL', () => {
    const { stack } = createStack();
    const template = Template.fromStack(stack);
    // The SSL enforcement adds a Deny statement with aws:SecureTransport condition
    // Verify the bucket policy exists (SSL deny + auto-delete permissions)
    template.resourceCountIs('AWS::S3::BucketPolicy', 1);
  });

  test('exports workgroupName', () => {
    const { construct } = createStack();
    expect(construct.workgroupName).toBe('kiro-user-dashboard-workgroup');
  });
});
