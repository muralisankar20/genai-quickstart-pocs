import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import { GlueConstruct } from './glue-construct';
import { AthenaConstruct } from './athena-construct';

export interface DashboardStackProps extends cdk.StackProps {
  sourceBucketName: string;
  sourceBucketPrefix: string;
  dataFormat: 'CSV' | 'JSON' | 'Parquet';
  crawlerSchedule?: string;
  queryMode?: 'DirectQuery' | 'SPICE';
}

export class DashboardStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DashboardStackProps) {
    super(scope, id, props);

    // Set default values for optional parameters
    const crawlerSchedule = props.crawlerSchedule || 'cron(30 1 * * ? *)';

    // Instantiate GlueConstruct with configured parameters
    const glueConstruct = new GlueConstruct(this, 'GlueConstruct', {
      sourceBucketName: props.sourceBucketName,
      sourceBucketPrefix: props.sourceBucketPrefix,
      dataFormat: props.dataFormat,
      crawlerSchedule: crawlerSchedule,
    });

    // Instantiate AthenaConstruct with Glue database reference
    const athenaConstruct = new AthenaConstruct(this, 'AthenaConstruct', {
      glueDatabase: glueConstruct.database,
    });

    // Wire dependencies: Athena depends on Glue database
    athenaConstruct.workgroup.addDependency(glueConstruct.database);

    // CloudFormation Outputs
    new cdk.CfnOutput(this, 'DashboardId', {
      value: 'kiro-user-dashboard',
      description: 'Dashboard ID for programmatic access',
    });

    new cdk.CfnOutput(this, 'DataSourceId', {
      value: 'kiro-user-dashboard-datasource',
      description: 'QuickSight Data Source ID',
    });

    new cdk.CfnOutput(this, 'DatasetId', {
      value: 'kiro-user-dashboard-dataset',
      description: 'QuickSight Dataset ID',
    });

    new cdk.CfnOutput(this, 'GlueDatabaseName', {
      value: glueConstruct.databaseName,
      description: 'Glue Database Name',
    });

    new cdk.CfnOutput(this, 'GlueTableName', {
      value: glueConstruct.tableName,
      description: 'Glue Table Name',
    });

    new cdk.CfnOutput(this, 'AthenaWorkgroupName', {
      value: athenaConstruct.workgroupName,
      description: 'Athena Workgroup Name',
    });

    // Note: QuickSight resources (data source, dataset, dashboard) are managed
    // by scripts/deploy-quicksight.ts and scripts/deploy-quicksight-full.sh,
    // not by this CDK stack. This avoids conflicts with existing resources.

    // ── cdk-nag suppressions ──
    // Suppress findings we've reviewed and accepted with documented reasons.

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-S1',
        reason: 'Access logging on Athena results bucket is not required for this internal dashboard. Results are ephemeral and auto-deleted after 30 days.',
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'Lambda runtime is managed by CDK autoDeleteObjects construct and cannot be directly controlled.',
      },
      {
        id: 'AwsSolutions-GL1',
        reason: 'Glue crawler CloudWatch log encryption is not required for this internal analytics workload. No sensitive data in crawler logs.',
      },
      {
        id: 'AwsSolutions-IAM4',
        appliesTo: [
          'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSGlueServiceRole',
          'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        ],
        reason: 'AWSGlueServiceRole is required for crawler operation. AWSLambdaBasicExecutionRole is managed by CDK autoDeleteObjects construct.',
      },
      {
        id: 'AwsSolutions-IAM5',
        appliesTo: [
          'Resource::*',
          'Resource::arn:aws:s3:::kiro-user-activity-ms/kiro-users/*',
        ],
        reason: 'Wildcard on S3 object keys is required to read all objects within the specific bucket prefixes. Bucket-level access is already scoped.',
      },
    ]);
  }
}
