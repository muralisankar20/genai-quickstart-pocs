import * as cdk from 'aws-cdk-lib';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as glue from 'aws-cdk-lib/aws-glue';
import { Construct } from 'constructs';

export interface AthenaConstructProps {
  glueDatabase: glue.CfnDatabase;
}

export class AthenaConstruct extends Construct {
  public readonly workgroup: athena.CfnWorkGroup;
  public readonly resultsBucket: s3.Bucket;
  public readonly workgroupName: string;

  constructor(scope: Construct, id: string, props: AthenaConstructProps) {
    super(scope, id);

    const accountId = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    // Define resource names
    this.workgroupName = 'kiro-user-dashboard-workgroup';
    const resultsBucketName = `kiro-user-dashboard-athena-results-${accountId}-${region}`;

    // Create S3 bucket for Athena query results with lifecycle policy
    this.resultsBucket = new s3.Bucket(this, 'ResultsBucket', {
      bucketName: resultsBucketName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'DeleteOldQueryResults',
          enabled: true,
          expiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Grant QuickSight service permissions to the results bucket
    this.resultsBucket.grantReadWrite(new iam.ServicePrincipal('quicksight.amazonaws.com'));

    // Create Athena Workgroup
    this.workgroup = new athena.CfnWorkGroup(this, 'Workgroup', {
      name: this.workgroupName,
      description: 'Workgroup for Kiro User Dashboard queries',
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
        resultConfiguration: {
          outputLocation: `s3://${this.resultsBucket.bucketName}/query-results/`,
          encryptionConfiguration: {
            encryptionOption: 'SSE_S3',
          },
        },
      },
    });
  }
}
