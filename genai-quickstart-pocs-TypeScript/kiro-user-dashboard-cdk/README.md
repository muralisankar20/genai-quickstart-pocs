# Kiro User Dashboard

AWS CDK project for provisioning a complete Amazon QuickSight dashboard solution with automated data refresh from S3.

## Architecture

This solution deploys:
- **AWS Glue** Database and Crawler for data cataloging
- **Amazon Athena** Workgroup for SQL queries
- **S3 bucket** for Athena query results
- **Amazon QuickSight** Data Source, Dataset, Analysis, and Dashboard (via AWS CLI scripts)

The dashboard includes 28 visuals across 10 sections covering KPIs, client type breakdown, top users, daily trends, credits analysis, subscription tiers, engagement levels, activity timeline, and conversion funnel.

## Prerequisites

- AWS account with appropriate permissions
- AWS CLI configured with credentials
- Set `AWS_PROFILE` environment variable to your AWS profile name, or pass `--profile YOUR_AWS_PROFILE` to CLI commands
- Node.js and npm installed
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- QuickSight subscription active in target AWS account
- S3 bucket with source data already created

## Configuration

### AWS Profile

All CLI commands in this guide use `--profile YOUR_AWS_PROFILE`. Replace `YOUR_AWS_PROFILE` with your actual AWS CLI profile name.

Alternatively, set the `AWS_PROFILE` environment variable once and omit `--profile` from commands:

```bash
export AWS_PROFILE=your-profile-name
```

The deployment scripts (`deploy-quicksight.ts`, `deploy-quicksight-full.sh`, `sync-user-lookup.ts`) read `AWS_PROFILE` from the environment. If not set, they use the `default` profile. The CDK profile is configured in `cdk.json` under `@aws-cdk/core:defaultProfile` — update this to match your profile name.

### Step 1: Update cdk.json

Edit `cdk.json` to configure deployment parameters:

```json
{
  "context": {
    "sourceBucketName": "your-bucket-name",
    "sourceBucketPrefix": "your-data-prefix/",
    "dataFormat": "CSV",
    "crawlerSchedule": "cron(30 1 * * ? *)",
    "queryMode": "DirectQuery",
    "quickSightUserArn": "arn:aws:quicksight:us-east-1:ACCOUNT_ID:user/default/USERNAME"
  }
}
```

### Step 2: Get Your QuickSight User ARN

```bash
aws quicksight list-users --aws-account-id YOUR_ACCOUNT_ID --namespace default --region us-east-1 --profile YOUR_AWS_PROFILE
```

Copy the ARN from the output and add it to `cdk.json` as shown above.

## Deployment

### Phase 1: Deploy Infrastructure (Glue & Athena)

```bash
npm install
npm run build
cdk bootstrap --profile YOUR_AWS_PROFILE    # first time only
cdk deploy --profile YOUR_AWS_PROFILE
```

### Phase 2: Run Glue Crawler

```bash
aws glue start-crawler --name kiro-user-dashboard-crawler --profile YOUR_AWS_PROFILE --region us-east-1
```

Wait for the crawler to complete:

```bash
aws glue get-crawler --name kiro-user-dashboard-crawler --profile YOUR_AWS_PROFILE --region us-east-1 --query 'Crawler.{State:State,LastStatus:LastCrawl.Status}'
```

### Phase 3: Create QuickSight Data Source

QuickSight data sources must be created via AWS CLI due to CloudFormation connection test limitations.

First, add bucket policy for QuickSight access:

```bash
# Get your QuickSight service role ARN
aws iam list-roles --profile YOUR_AWS_PROFILE --query 'Roles[?contains(RoleName, `quicksight`)].{RoleName:RoleName,Arn:Arn}'

# Add bucket policy (replace ACCOUNT_ID)
aws s3api put-bucket-policy --bucket kiro-user-dashboard-athena-results-ACCOUNT_ID-us-east-1 --policy '{
  "Version":"2012-10-17",
  "Statement":[{
    "Effect":"Allow",
    "Principal":{"AWS":"arn:aws:iam::ACCOUNT_ID:role/service-role/aws-quicksight-service-role-v0"},
    "Action":["s3:GetObject","s3:ListBucket","s3:PutObject","s3:GetBucketLocation"],
    "Resource":[
      "arn:aws:s3:::kiro-user-dashboard-athena-results-ACCOUNT_ID-us-east-1",
      "arn:aws:s3:::kiro-user-dashboard-athena-results-ACCOUNT_ID-us-east-1/*"
    ]
  }]
}' --profile YOUR_AWS_PROFILE --region us-east-1
```

Then create the data source:

```bash
aws quicksight create-data-source \
  --aws-account-id YOUR_ACCOUNT_ID \
  --data-source-id kiro-user-dashboard-datasource \
  --name "Kiro User Dashboard Data Source" \
  --type ATHENA \
  --data-source-parameters '{"AthenaParameters":{"WorkGroup":"kiro-user-dashboard-workgroup"}}' \
  --permissions '[{"Principal":"YOUR_QUICKSIGHT_USER_ARN","Actions":["quicksight:DescribeDataSource","quicksight:DescribeDataSourcePermissions","quicksight:PassDataSource","quicksight:UpdateDataSource","quicksight:DeleteDataSource","quicksight:UpdateDataSourcePermissions"]}]' \
  --profile YOUR_AWS_PROFILE --region us-east-1
```

### Phase 4: Deploy QuickSight Dataset, Analysis & Dashboard

#### Option A: Full Setup (Recommended for first-time deployment)

Run the end-to-end script that creates the data source, dataset, analysis, and dashboard:

```bash
chmod +x scripts/deploy-quicksight-full.sh
./scripts/deploy-quicksight-full.sh
```

#### Option B: Analysis & Dashboard Only

If the data source and dataset already exist, deploy just the analysis and dashboard:

```bash
npx ts-node scripts/deploy-quicksight.ts
```

This script reads visual definitions from `lib/dashboard-visuals.ts`, generates the full definition JSON, and creates/updates the analysis and dashboard via AWS CLI. It supports both create and update operations automatically.

### Update Dashboard

After modifying visuals in `lib/dashboard-visuals.ts`, redeploy:

```bash
npx ts-node scripts/deploy-quicksight.ts
```

### Dashboard URL

After deployment, access the dashboard through the AWS Console: Services → QuickSight → Dashboards → "Kiro User Dashboard".

The direct URL is `https://us-east-1.quicksight.aws.amazon.com/sn/dashboards/kiro-user-dashboard` but it only works if you're already signed into QuickSight. If you access AWS via IAM federation, use the Console approach instead.

## Project Structure

```
├── bin/app.ts                          # CDK app entry point
├── lib/
│   ├── glue-construct.ts               # Glue database, crawler, IAM role
│   ├── athena-construct.ts             # Athena workgroup, results bucket
│   ├── quicksight-construct.ts         # QuickSight data source, dataset, calculated fields
│   ├── dashboard-stack.ts              # Main stack wiring all constructs
│   └── dashboard-visuals.ts            # All 28 visual definitions (10 sections)
├── scripts/
│   ├── deploy-quicksight-full.sh       # End-to-end QuickSight setup
│   ├── deploy-quicksight.ts            # Analysis + dashboard deployment script
│   └── sync-user-lookup.ts             # Sync Identity Center users to S3 lookup table
├── specs/                              # Spec-driven development artifacts
├── cdk.json                            # CDK configuration and context
└── package.json
```

## Deployed Resources

After successful deployment, you'll have:

| Resource | Name/ID |
|----------|---------|
| Glue Database | `kiro-user-dashboard-db` |
| Glue Crawler | `kiro-user-dashboard-crawler` (scheduled 1:30 AM daily) |
| Glue Table | `user_report` (name based on S3 folder structure) |
| Glue Table | `user_lookup` (Identity Center user mapping) |
| Athena Workgroup | `kiro-user-dashboard-workgroup` |
| S3 Results Bucket | `kiro-user-dashboard-athena-results-{account-id}-us-east-1` |
| QuickSight Data Source | `kiro-user-dashboard-datasource` |
| QuickSight Dataset | `kiro-user-dashboard-dataset` |
| QuickSight Analysis | `kiro-user-dashboard-analysis` |
| QuickSight Dashboard | `kiro-user-dashboard` |

## Verification

```bash
# Test Athena query
aws athena start-query-execution \
  --query-string "SELECT * FROM user_report LIMIT 10" \
  --query-execution-context Database=kiro-user-dashboard-db \
  --result-configuration OutputLocation=s3://kiro-user-dashboard-athena-results-ACCOUNT_ID-us-east-1/query-results/ \
  --work-group kiro-user-dashboard-workgroup \
  --profile YOUR_AWS_PROFILE --region us-east-1

# Check analysis status
aws quicksight describe-analysis --aws-account-id ACCOUNT_ID --analysis-id kiro-user-dashboard-analysis --profile YOUR_AWS_PROFILE --region us-east-1 --query 'Analysis.Status'

# Check dashboard status
aws quicksight describe-dashboard --aws-account-id ACCOUNT_ID --dashboard-id kiro-user-dashboard --profile YOUR_AWS_PROFILE --region us-east-1 --query 'Dashboard.Version.Status'
```

## Troubleshooting

### Glue Crawler finds no tables or wrong table names
The crawler creates table names based on S3 folder structure, not the configured parameter. Verify the actual table name after the first crawler run and update `lib/dashboard-stack.ts` if needed.

### QuickSight data source creation fails with "Connection test failed"
Known limitation with QuickSight CloudFormation resources. Use AWS CLI instead (see Phase 3). Ensure the S3 bucket policy grants permissions to the QuickSight service role.

### QuickSight column type errors in visual definitions
- Use `CategoricalMeasureField` (not `NumericalMeasureField`) for COUNT aggregations on string columns
- Use `NumericalDimensionField` for INTEGER columns (e.g., `total_messages`, `is_active`) — they cannot be `CategoricalDimensionField`
- STRING date columns cannot use `RelativeDatesFilter` — use `CategoryFilter` instead

### Analysis/Dashboard creation fails with CREATION_FAILED
Check the definition JSON in `.tmp/` for errors. Common causes: invalid column references, incompatible field types, or missing dataset columns. Run `npx ts-node scripts/deploy-quicksight.ts` again after fixing.

### Deleted analysis still found by describe-analysis
QuickSight soft-deletes analyses. Use `restore-analysis` to recover, or the deploy script handles this automatically by checking the analysis status.

### Dashboard visuals show "insufficient permissions to connect to this dataset"
The QuickSight service role needs read access to the source data S3 bucket (not just the Athena results bucket). Add a bucket policy granting `s3:GetObject`, `s3:ListBucket`, `s3:GetBucketLocation` to the QuickSight service role on the source bucket.

### Dashboard not updating after redeploy
After `update-dashboard`, the new version is not automatically the published version. The deploy script uses `list-dashboard-versions` to find the latest version and publishes it. If you see stale data, check the published version number.

### CDK bootstrap stack outdated
Run `cdk bootstrap --profile YOUR_AWS_PROFILE` to update the CDK toolkit stack.

### Direct dashboard URL shows QuickSight login page instead of dashboard
Direct dashboard URLs redirect to the QuickSight native login page, which requires a QuickSight-native username and password. If you access QuickSight via IAM federation (e.g., through the AWS Console), navigate to QuickSight through the AWS Console instead: Services → QuickSight → Dashboards → select the dashboard.

## Lessons Learned

1. **QuickSight CloudFormation Limitations**: QuickSight data sources run connection tests during CloudFormation deployment that often fail. Using AWS CLI is more reliable.

2. **Glue Crawler Table Naming**: The crawler names tables based on S3 folder structure, not the configured parameter. Always verify after the first run.

3. **S3 Bucket Policies**: QuickSight requires explicit bucket policies granting access to the QuickSight service role.

4. **Column Type Handling in QuickSight API**: `NumericalMeasureField` doesn't support `CountDistinctFunction` — use `CategoricalMeasureField` with `DISTINCT_COUNT` instead. INTEGER columns must use `NumericalDimensionField`, not `CategoricalDimensionField`.

5. **QuickSight Soft Deletes**: Deleted analyses go to a soft-delete state. `describe-analysis` still finds them but `update-analysis` fails. Check the status field and use `restore-analysis` if needed.

6. **Source S3 Bucket Policy**: The QuickSight service role needs read access to the source data S3 bucket (not just the Athena results bucket). Without this, the dashboard loads but visuals show "insufficient permissions to connect to this dataset."

7. **Dashboard Version Publishing**: After `update-dashboard`, the new version is not automatically published. The deploy script must use `list-dashboard-versions` to find the latest version number and explicitly publish it with `update-dashboard-published-version`.

8. **QuickSight Multi-User Permissions**: When multiple users (e.g., IAM user + federated user) need dashboard access, permissions must be granted on all three resources: data source, dataset, and dashboard. The QuickSight account name (shown in URL) is different from the username.

9. **COUNT vs DISTINCT_COUNT**: `CategoricalMeasureField` with `COUNT` counts all rows. Use `DISTINCT_COUNT` to count unique values (e.g., distinct users). This is critical for KPI visuals.

10. **User ID Format**: Source data may contain the same user with different userid formats (e.g., bare UUID vs `directory-id.UUID`). Create a user lookup table from Identity Center to map raw userids to friendly display names.

11. **Identity Center User Lookup Table**: Use `identitystore list-users` API to pull users, generate a CSV with all userid formats (bare UUID, directory-prefixed, quoted), upload to S3, create a Glue table, and LEFT JOIN in the QuickSight dataset. The `scripts/sync-user-lookup.ts` script automates this. Run it whenever new users are added to Identity Center.

12. **QuickSight Dataset JOIN — ALIAS_NAME_CONFLICT**: When joining two tables that share a column name (e.g., `userid`), QuickSight throws `ALIAS_NAME_CONFLICT`. Rename the duplicate column in the right-side logical table using `RenameColumnOperation` before the join (e.g., `userid` → `lookup_userid`), then use `{userid} = {lookup_userid}` in the `OnClause`.

13. **Glue Table for CSV with Headers**: When creating a Glue table manually (not via crawler) for a CSV with a header row, set `"skip.header.line.count": "1"` in the table parameters and use `OpenCSVSerde` as the serialization library.

14. **Auto-Detection for Shareable Scripts**: Use `aws sts get-caller-identity` to auto-detect account ID, `aws quicksight list-users` to find the first active ADMIN user ARN, and `aws sso-admin list-instances` to discover the Identity Store ID. This eliminates hardcoded values and makes scripts portable across accounts. Scripts fall back to `cdk.json` configuration if available (and not set to placeholder values).

15. **QuickSight Dashboard Access — Console vs Direct URL**: Direct dashboard URLs (e.g., `https://region.quicksight.aws.amazon.com/sn/dashboards/...`) redirect to the QuickSight native login page, which doesn't work for IAM federated users. Instead, access the dashboard through the AWS Console: navigate to QuickSight service → Dashboards → select the dashboard. This uses your existing console session for authentication.

16. **Code Shareability — Placeholder Pattern**: Use `YOUR_ACCOUNT_ID` and `YOUR_USERNAME` placeholders in `cdk.json` for account-specific values. Scripts detect these placeholders (checking for `YOUR_` prefix) and fall back to auto-detection. This lets new users clone the repo and run scripts immediately without editing configuration, while still allowing explicit configuration when needed.

## Useful Commands

```bash
npm run build                              # Compile TypeScript
npm run watch                              # Watch for changes and compile
cdk deploy --profile YOUR_AWS_PROFILE                   # Deploy CDK stack
cdk diff --profile YOUR_AWS_PROFILE                     # Compare deployed vs current
cdk synth                                  # Emit CloudFormation template
cdk destroy --profile YOUR_AWS_PROFILE                  # Remove CDK resources
npx ts-node scripts/deploy-quicksight.ts   # Deploy/update analysis + dashboard
./scripts/deploy-quicksight-full.sh        # Full QuickSight setup (all resources)
npx ts-node scripts/sync-user-lookup.ts    # Sync Identity Center users to lookup table
```

## Clean Up

To remove all resources:

```bash
# Delete QuickSight dashboard and analysis
aws quicksight delete-dashboard --aws-account-id ACCOUNT_ID --dashboard-id kiro-user-dashboard --profile YOUR_AWS_PROFILE --region us-east-1
aws quicksight delete-analysis --aws-account-id ACCOUNT_ID --analysis-id kiro-user-dashboard-analysis --profile YOUR_AWS_PROFILE --region us-east-1

# Delete QuickSight dataset and data source
aws quicksight delete-data-set --aws-account-id ACCOUNT_ID --data-set-id kiro-user-dashboard-dataset --profile YOUR_AWS_PROFILE --region us-east-1
aws quicksight delete-data-source --aws-account-id ACCOUNT_ID --data-source-id kiro-user-dashboard-datasource --profile YOUR_AWS_PROFILE --region us-east-1

# Delete user lookup table and S3 data
aws glue delete-table --database-name kiro-user-dashboard-db --name user_lookup --profile YOUR_AWS_PROFILE --region us-east-1
aws s3 rm s3://kiro-user-dashboard-athena-results-ACCOUNT_ID-us-east-1/user-lookup/ --recursive --profile YOUR_AWS_PROFILE

# Destroy CDK stack (Glue, Athena, S3)
cdk destroy --profile YOUR_AWS_PROFILE
```

## User Lookup Table

The dashboard maps raw userids to friendly display names from Identity Center. This is managed by a lookup CSV in S3 joined to the main dataset.

### Sync Users

When new users are added to Identity Center, refresh the lookup table:

```bash
npx ts-node scripts/sync-user-lookup.ts
```

This pulls all users from Identity Center, generates a CSV with all userid formats (bare UUID, directory-prefixed, quoted), and uploads it to S3. The Glue table `user_lookup` and QuickSight dataset join are already configured — no further action needed after syncing.
