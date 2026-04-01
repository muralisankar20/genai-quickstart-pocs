# Kiro User Dashboard - Deployment Guide

## Prerequisites

- AWS account with admin permissions
- AWS CLI installed and configured
- Node.js (v14+) and npm
- AWS CDK CLI: `npm install -g aws-cdk`
- QuickSight subscription active (Enterprise edition)
- S3 bucket with source data

Set your AWS profile for all commands:
```bash
export AWS_PROFILE=your-profile-name
```

## Step 1: Configure

Edit `cdk.json` context section:
```json
{
  "context": {
    "@aws-cdk/core:defaultProfile": "your-profile-name",
    "sourceBucketName": "your-s3-bucket-name",
    "sourceBucketPrefix": "your-data-prefix/",
    "quickSightUserArn": "arn:aws:quicksight:us-east-1:YOUR_ACCOUNT_ID:user/default/YOUR_USERNAME"
  }
}
```

To find your QuickSight user ARN:
```bash
aws quicksight list-users --aws-account-id $(aws sts get-caller-identity --query Account --output text) --namespace default --region us-east-1
```

## Step 2: Deploy Infrastructure

```bash
npm install
npm run build
cdk bootstrap --profile $AWS_PROFILE    # first time only
cdk deploy --profile $AWS_PROFILE
```

## Step 3: Run Glue Crawler

```bash
aws glue start-crawler --name kiro-user-dashboard-crawler --region us-east-1
```

Wait for it to finish (takes ~1-2 minutes):
```bash
aws glue get-crawler --name kiro-user-dashboard-crawler --region us-east-1 \
  --query 'Crawler.{State:State,Status:LastCrawl.Status}' --output table
```

## Step 4: Add S3 Bucket Policies

QuickSight needs read access to both the source data bucket and the Athena results bucket.

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
SERVICE_ROLE="arn:aws:iam::${ACCOUNT_ID}:role/service-role/aws-quicksight-service-role-v0"

# Grant access to Athena results bucket
aws s3api put-bucket-policy \
  --bucket kiro-user-dashboard-athena-results-${ACCOUNT_ID}-us-east-1 \
  --policy '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"AWS":"'"$SERVICE_ROLE"'"},
      "Action":["s3:GetObject","s3:ListBucket","s3:PutObject","s3:GetBucketLocation"],
      "Resource":[
        "arn:aws:s3:::kiro-user-dashboard-athena-results-'"$ACCOUNT_ID"'-us-east-1",
        "arn:aws:s3:::kiro-user-dashboard-athena-results-'"$ACCOUNT_ID"'-us-east-1/*"
      ]
    }]
  }'

# Grant access to source data bucket
aws s3api put-bucket-policy \
  --bucket YOUR_SOURCE_BUCKET \
  --policy '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"AWS":"'"$SERVICE_ROLE"'"},
      "Action":["s3:GetObject","s3:ListBucket","s3:GetBucketLocation"],
      "Resource":[
        "arn:aws:s3:::YOUR_SOURCE_BUCKET",
        "arn:aws:s3:::YOUR_SOURCE_BUCKET/*"
      ]
    }]
  }'
```

## Step 5: Deploy QuickSight Resources

Run the full setup script (creates data source, dataset, analysis, and dashboard):

```bash
chmod +x scripts/deploy-quicksight-full.sh
./scripts/deploy-quicksight-full.sh
```

The script auto-detects your account ID and QuickSight user ARN.

## Step 6: Sync User Lookup Table (Optional)

To show friendly display names instead of raw user IDs:

```bash
npx ts-node scripts/sync-user-lookup.ts
```

This pulls users from Identity Center and uploads a lookup CSV to S3. Run it again whenever new users are added.

## Step 7: Verify

Access the dashboard through the AWS Console: Services → QuickSight → Dashboards → "Kiro User Dashboard"

Or check status via CLI:
```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws quicksight describe-dashboard --aws-account-id $ACCOUNT_ID --dashboard-id kiro-user-dashboard --region us-east-1 --query 'Dashboard.Version.Status'
```

## Deployment Complete

You're done. The dashboard is live and accessible through the AWS Console.

---

## Reference (Post-Deployment)

### Adding Users to the Dashboard

Users must already exist in QuickSight before you can grant them dashboard access. IAM federated users are auto-registered the first time they open QuickSight through the AWS Console — just have them visit the QuickSight service page once. Alternatively, register a user manually:

```bash
aws quicksight register-user \
  --aws-account-id $ACCOUNT_ID \
  --namespace default \
  --identity-type IAM \
  --iam-arn arn:aws:iam::${ACCOUNT_ID}:user/USERNAME \
  --user-role READER \
  --email user@example.com \
  --region us-east-1
```

Once the user exists, find their QuickSight ARN:
```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws quicksight list-users --aws-account-id $ACCOUNT_ID --namespace default --region us-east-1
```

**Grant read-only access (viewer):**
```bash
USER_ARN="arn:aws:quicksight:us-east-1:${ACCOUNT_ID}:user/default/USERNAME"

aws quicksight update-dashboard-permissions \
  --aws-account-id $ACCOUNT_ID \
  --dashboard-id kiro-user-dashboard \
  --grant-permissions "[{\"Principal\":\"$USER_ARN\",\"Actions\":[\"quicksight:DescribeDashboard\",\"quicksight:ListDashboardVersions\",\"quicksight:QueryDashboard\"]}]" \
  --region us-east-1
```

**Grant full access (author — can edit visuals and manage permissions):**
```bash
USER_ARN="arn:aws:quicksight:us-east-1:${ACCOUNT_ID}:user/default/USERNAME"

# Dashboard permissions
aws quicksight update-dashboard-permissions \
  --aws-account-id $ACCOUNT_ID \
  --dashboard-id kiro-user-dashboard \
  --grant-permissions "[{\"Principal\":\"$USER_ARN\",\"Actions\":[\"quicksight:DescribeDashboard\",\"quicksight:ListDashboardVersions\",\"quicksight:UpdateDashboardPermissions\",\"quicksight:QueryDashboard\",\"quicksight:UpdateDashboard\",\"quicksight:DeleteDashboard\",\"quicksight:DescribeDashboardPermissions\",\"quicksight:UpdateDashboardPublishedVersion\"]}]" \
  --region us-east-1

# Dataset permissions (needed to edit visuals)
aws quicksight update-data-set-permissions \
  --aws-account-id $ACCOUNT_ID \
  --data-set-id kiro-user-dashboard-dataset \
  --grant-permissions "[{\"Principal\":\"$USER_ARN\",\"Actions\":[\"quicksight:DescribeDataSet\",\"quicksight:DescribeDataSetPermissions\",\"quicksight:PassDataSet\",\"quicksight:UpdateDataSet\",\"quicksight:DeleteDataSet\",\"quicksight:UpdateDataSetPermissions\"]}]" \
  --region us-east-1

# Data source permissions
aws quicksight update-data-source-permissions \
  --aws-account-id $ACCOUNT_ID \
  --data-source-id kiro-user-dashboard-datasource \
  --grant-permissions "[{\"Principal\":\"$USER_ARN\",\"Actions\":[\"quicksight:DescribeDataSource\",\"quicksight:DescribeDataSourcePermissions\",\"quicksight:PassDataSource\",\"quicksight:UpdateDataSource\",\"quicksight:DeleteDataSource\",\"quicksight:UpdateDataSourcePermissions\"]}]" \
  --region us-east-1
```

### Updating the Dashboard

If you modify visuals in `lib/dashboard-visuals.ts` later:

```bash
npx ts-node scripts/deploy-quicksight.ts
```

### Clean Up (Remove All Resources)

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws quicksight delete-dashboard --aws-account-id $ACCOUNT_ID --dashboard-id kiro-user-dashboard --region us-east-1
aws quicksight delete-analysis --aws-account-id $ACCOUNT_ID --analysis-id kiro-user-dashboard-analysis --region us-east-1
aws quicksight delete-data-set --aws-account-id $ACCOUNT_ID --data-set-id kiro-user-dashboard-dataset --region us-east-1
aws quicksight delete-data-source --aws-account-id $ACCOUNT_ID --data-source-id kiro-user-dashboard-datasource --region us-east-1
aws glue delete-table --database-name kiro-user-dashboard-db --name user_lookup --region us-east-1
aws s3 rm s3://kiro-user-dashboard-athena-results-${ACCOUNT_ID}-us-east-1/user-lookup/ --recursive
cdk destroy --profile $AWS_PROFILE
```
