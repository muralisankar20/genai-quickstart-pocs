import * as cdk from 'aws-cdk-lib';
import * as quicksight from 'aws-cdk-lib/aws-quicksight';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface QuickSightConstructProps {
  athenaWorkgroup: athena.CfnWorkGroup;
  glueDatabase: glue.CfnDatabase;
  glueDatabaseName: string;
  glueTableName: string;
  queryMode: 'DirectQuery' | 'SPICE';
  awsAccountId: string;
  quickSightUserArn: string;
  athenaResultsBucket: s3.Bucket;
  sourceBucketName: string;
}

export class QuickSightConstruct extends Construct {
  public readonly dataSource: quicksight.CfnDataSource;
  public readonly quickSightRole: iam.Role;
  public readonly dataset: quicksight.CfnDataSet;
  public readonly datasetId: string;

  constructor(scope: Construct, id: string, props: QuickSightConstructProps) {
    super(scope, id);

    const region = cdk.Stack.of(this).region;

    // Define resource names
    const dataSourceName = 'kiro-user-dashboard-datasource';
    const quickSightRoleName = 'kiro-user-dashboard-quicksight-role';
    this.datasetId = 'kiro-user-dashboard-dataset';

    // Create IAM role for QuickSight with Athena, Glue, and S3 permissions
    this.quickSightRole = new iam.Role(this, 'QuickSightRole', {
      roleName: quickSightRoleName,
      assumedBy: new iam.ServicePrincipal('quicksight.amazonaws.com'),
      description: 'IAM role for Kiro User Dashboard QuickSight access',
    });

    // Add Athena permissions
    this.quickSightRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'athena:GetWorkGroup',
          'athena:StartQueryExecution',
          'athena:GetQueryExecution',
          'athena:GetQueryResults',
        ],
        resources: [
          `arn:aws:athena:${region}:${props.awsAccountId}:workgroup/${props.athenaWorkgroup.name}`,
        ],
      })
    );

    // Add Glue permissions
    this.quickSightRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'glue:GetDatabase',
          'glue:GetTable',
          'glue:GetTables',
          'glue:GetPartitions',
        ],
        resources: [
          `arn:aws:glue:${region}:${props.awsAccountId}:catalog`,
          `arn:aws:glue:${region}:${props.awsAccountId}:database/${props.glueDatabaseName}`,
          `arn:aws:glue:${region}:${props.awsAccountId}:table/${props.glueDatabaseName}/*`,
        ],
      })
    );

    // Add S3 permissions for source and Athena results buckets
    this.quickSightRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:ListBucket',
          's3:PutObject',
          's3:DeleteObject',
        ],
        resources: [
          props.athenaResultsBucket.bucketArn,
          `${props.athenaResultsBucket.bucketArn}/*`,
          `arn:aws:s3:::${props.sourceBucketName}`,
          `arn:aws:s3:::${props.sourceBucketName}/*`,
        ],
      })
    );

    // Create QuickSight Data Source connected to Athena workgroup
    this.dataSource = new quicksight.CfnDataSource(this, 'DataSource', {
      awsAccountId: props.awsAccountId,
      dataSourceId: dataSourceName,
      name: dataSourceName,
      type: 'ATHENA',
      dataSourceParameters: {
        athenaParameters: {
          workGroup: props.athenaWorkgroup.name,
        },
      },
      permissions: [
        {
          principal: props.quickSightUserArn,
          actions: [
            'quicksight:DescribeDataSource',
            'quicksight:DescribeDataSourcePermissions',
            'quicksight:PassDataSource',
            'quicksight:UpdateDataSource',
            'quicksight:DeleteDataSource',
            'quicksight:UpdateDataSourcePermissions',
          ],
        },
      ],
    });

    // Ensure data source is created after the workgroup
    this.dataSource.addDependency(props.athenaWorkgroup);

    // Create QuickSight Dataset referencing Glue catalog table
    this.dataset = new quicksight.CfnDataSet(this, 'Dataset', {
      awsAccountId: props.awsAccountId,
      dataSetId: this.datasetId,
      name: this.datasetId,
      importMode: props.queryMode === 'SPICE' ? 'SPICE' : 'DIRECT_QUERY',
      physicalTableMap: {
        'PhysicalTable1': {
          relationalTable: {
            dataSourceArn: this.dataSource.attrArn,
            catalog: 'AwsDataCatalog',
            schema: props.glueDatabaseName,
            name: props.glueTableName,
            inputColumns: [
              { name: 'date', type: 'STRING' },
              { name: 'userid', type: 'STRING' },
              { name: 'client_type', type: 'STRING' },
              { name: 'chat_conversations', type: 'INTEGER' },
              { name: 'credits_used', type: 'DECIMAL' },
              { name: 'overage_cap', type: 'DECIMAL' },
              { name: 'overage_credits_used', type: 'DECIMAL' },
              { name: 'overage_enabled', type: 'STRING' },
              { name: 'profileid', type: 'STRING' },
              { name: 'subscription_tier', type: 'STRING' },
              { name: 'total_messages', type: 'INTEGER' },
            ],
          },
        },
      },
      logicalTableMap: {
        'LogicalTable1': {
          alias: 'user_activity',
          source: {
            physicalTableId: 'PhysicalTable1',
          },
          dataTransforms: [
            {
              createColumnsOperation: {
                columns: [
                  {
                    columnName: 'engagement_level',
                    columnId: 'engagement_level',
                    expression: "ifelse({total_messages} >= 100 OR {chat_conversations} >= 20, 'Power User', ifelse({total_messages} >= 20 OR {chat_conversations} >= 5, 'Active User', ifelse({total_messages} >= 1, 'Light User', 'Idle User')))",
                  },
                  {
                    columnName: 'days_since_last_activity',
                    columnId: 'days_since_last_activity',
                    expression: 'dateDiff(parseDate({date}, "yyyy-MM-dd"), now(), "DD")',
                  },
                  {
                    columnName: 'total_credits',
                    columnId: 'total_credits',
                    expression: '{credits_used} + {overage_credits_used}',
                  },
                  {
                    columnName: 'is_active',
                    columnId: 'is_active',
                    expression: '{total_messages} > 0 OR {chat_conversations} > 0',
                  },
                ],
              },
            },
          ],
        },
      },
      permissions: [
        {
          principal: props.quickSightUserArn,
          actions: [
            'quicksight:DescribeDataSet',
            'quicksight:DescribeDataSetPermissions',
            'quicksight:PassDataSet',
            'quicksight:DescribeIngestion',
            'quicksight:ListIngestions',
            'quicksight:UpdateDataSet',
            'quicksight:DeleteDataSet',
            'quicksight:CreateIngestion',
            'quicksight:CancelIngestion',
            'quicksight:UpdateDataSetPermissions',
          ],
        },
      ],
    });

    // Configure SPICE refresh schedule if SPICE mode (daily at 2:00 AM)
    if (props.queryMode === 'SPICE') {
      new quicksight.CfnRefreshSchedule(this, 'RefreshSchedule', {
        awsAccountId: props.awsAccountId,
        dataSetId: this.datasetId,
        schedule: {
          refreshType: 'FULL_REFRESH',
          scheduleFrequency: {
            interval: 'DAILY',
            timeOfTheDay: '02:00',
          },
        },
      });
    }

    // Ensure dataset is created after the data source
    this.dataset.addDependency(this.dataSource);

    // Note: QuickSight Groups cannot be created via CloudFormation
    // Groups must be created manually through the AWS Console or CLI:
    // - Viewer group: kiro-dashboard-viewers (read-only access)
    // - Author group: kiro-dashboard-authors (edit access)
    // See README.md for post-deployment configuration steps
  }
}
