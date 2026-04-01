#!/bin/bash
# ============================================================================
# Full QuickSight Deployment Script
# Creates data source, dataset, analysis, and dashboard via AWS CLI.
#
# Usage:
#   chmod +x scripts/deploy-quicksight-full.sh
#   ./scripts/deploy-quicksight-full.sh
#
# Prerequisites:
#   - CDK stack deployed (Glue + Athena resources exist)
#   - AWS CLI configured (set AWS_PROFILE env var or uses "default" profile)
#   - QuickSight subscription active in the account
# ============================================================================

set -euo pipefail

PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"

# Auto-detect account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile "$PROFILE" --region "$REGION")
echo "Detected AWS Account: $ACCOUNT_ID"

# Auto-detect QuickSight user ARN (first active ADMIN user)
QS_USER_ARN=$(aws quicksight list-users \
  --aws-account-id "$ACCOUNT_ID" \
  --namespace default \
  --profile "$PROFILE" \
  --region "$REGION" \
  --query 'UserList[?Role==`ADMIN` && Active==`true` && Arn!=`N/A`].Arn | [0]' \
  --output text 2>/dev/null || echo "")

if [ -z "$QS_USER_ARN" ] || [ "$QS_USER_ARN" = "None" ]; then
  echo "❌ No active QuickSight ADMIN user found."
  echo "   Create a QuickSight user first, or set QS_USER_ARN environment variable."
  exit 1
fi
echo "Detected QuickSight User: $QS_USER_ARN"

# Resource IDs
DATASOURCE_ID="kiro-user-dashboard-datasource"
DATASET_ID="kiro-user-dashboard-dataset"
WORKGROUP="kiro-user-dashboard-workgroup"
GLUE_DB="kiro-user-dashboard-db"
GLUE_TABLE="user_report"

echo ""
echo "🚀 Kiro User Dashboard - Full QuickSight Setup"
echo "================================================"
echo ""

# ── Step 1: Create Data Source ───────────────────────────────────────────
echo "📦 Step 1: Creating QuickSight Data Source..."

aws quicksight create-data-source \
  --aws-account-id "$ACCOUNT_ID" \
  --data-source-id "$DATASOURCE_ID" \
  --name "$DATASOURCE_ID" \
  --type ATHENA \
  --data-source-parameters '{"AthenaParameters":{"WorkGroup":"'"$WORKGROUP"'"}}' \
  --permissions '[{"Principal":"'"$QS_USER_ARN"'","Actions":["quicksight:DescribeDataSource","quicksight:DescribeDataSourcePermissions","quicksight:PassDataSource","quicksight:UpdateDataSource","quicksight:DeleteDataSource","quicksight:UpdateDataSourcePermissions"]}]' \
  --profile "$PROFILE" \
  --region "$REGION" \
  2>/dev/null && echo "✅ Data source created." || echo "⚠️  Data source may already exist (continuing)."

echo ""

# ── Step 2: Create Dataset ───────────────────────────────────────────────
echo "📦 Step 2: Creating QuickSight Dataset..."

DATASOURCE_ARN="arn:aws:quicksight:${REGION}:${ACCOUNT_ID}:datasource/${DATASOURCE_ID}"

cat > /tmp/qs-dataset.json << DATASET_EOF
{
  "AwsAccountId": "$ACCOUNT_ID",
  "DataSetId": "$DATASET_ID",
  "Name": "$DATASET_ID",
  "ImportMode": "DIRECT_QUERY",
  "PhysicalTableMap": {
    "PhysicalTable1": {
      "RelationalTable": {
        "DataSourceArn": "$DATASOURCE_ARN",
        "Catalog": "AwsDataCatalog",
        "Schema": "$GLUE_DB",
        "Name": "$GLUE_TABLE",
        "InputColumns": [
          {"Name": "date", "Type": "STRING"},
          {"Name": "userid", "Type": "STRING"},
          {"Name": "client_type", "Type": "STRING"},
          {"Name": "chat_conversations", "Type": "INTEGER"},
          {"Name": "credits_used", "Type": "DECIMAL"},
          {"Name": "overage_cap", "Type": "DECIMAL"},
          {"Name": "overage_credits_used", "Type": "DECIMAL"},
          {"Name": "overage_enabled", "Type": "STRING"},
          {"Name": "profileid", "Type": "STRING"},
          {"Name": "subscription_tier", "Type": "STRING"},
          {"Name": "total_messages", "Type": "INTEGER"}
        ]
      }
    }
  },
  "LogicalTableMap": {
    "LogicalTable1": {
      "Alias": "user_activity",
      "Source": {"PhysicalTableId": "PhysicalTable1"},
      "DataTransforms": [
        {
          "CreateColumnsOperation": {
            "Columns": [
              {
                "ColumnName": "engagement_level",
                "ColumnId": "engagement_level",
                "Expression": "ifelse({total_messages} >= 100 OR {chat_conversations} >= 20, 'Power User', ifelse({total_messages} >= 20 OR {chat_conversations} >= 5, 'Active User', ifelse({total_messages} >= 1, 'Light User', 'Idle User')))"
              },
              {
                "ColumnName": "days_since_last_activity",
                "ColumnId": "days_since_last_activity",
                "Expression": "dateDiff(parseDate({date}, \"yyyy-MM-dd\"), now(), \"DD\")"
              },
              {
                "ColumnName": "total_credits",
                "ColumnId": "total_credits",
                "Expression": "{credits_used} + {overage_credits_used}"
              },
              {
                "ColumnName": "is_active",
                "ColumnId": "is_active",
                "Expression": "{total_messages} > 0 OR {chat_conversations} > 0"
              }
            ]
          }
        }
      ]
    }
  },
  "Permissions": [
    {
      "Principal": "$QS_USER_ARN",
      "Actions": [
        "quicksight:DescribeDataSet",
        "quicksight:DescribeDataSetPermissions",
        "quicksight:PassDataSet",
        "quicksight:DescribeIngestion",
        "quicksight:ListIngestions",
        "quicksight:UpdateDataSet",
        "quicksight:DeleteDataSet",
        "quicksight:CreateIngestion",
        "quicksight:CancelIngestion",
        "quicksight:UpdateDataSetPermissions"
      ]
    }
  ]
}
DATASET_EOF

aws quicksight create-data-set \
  --cli-input-json file:///tmp/qs-dataset.json \
  --profile "$PROFILE" \
  --region "$REGION" \
  2>/dev/null && echo "✅ Dataset created." || echo "⚠️  Dataset may already exist (continuing)."

echo ""

# ── Step 3: Create Analysis & Dashboard ──────────────────────────────────
echo "📦 Step 3: Creating Analysis and Dashboard..."
echo "   Running TypeScript deployment script..."
echo ""

npx ts-node scripts/deploy-quicksight.ts

echo ""
echo "================================================"
echo "🎉 Full deployment complete!"
echo ""
echo "Next steps:"
echo "  1. Open the dashboard URL printed above"
echo "  2. Optionally create QuickSight groups for access control:"
echo "     aws quicksight create-group --aws-account-id $ACCOUNT_ID --namespace default --group-name kiro-dashboard-viewers --profile $PROFILE --region $REGION"
echo "     aws quicksight create-group --aws-account-id $ACCOUNT_ID --namespace default --group-name kiro-dashboard-authors --profile $PROFILE --region $REGION"
