#!/usr/bin/env npx ts-node
/**
 * QuickSight Dashboard Deployment Script
 *
 * Creates the QuickSight Analysis and Dashboard via AWS CLI.
 * This script exists because QuickSight CfnDataSource fails CloudFormation
 * connection tests during deployment. The data source and dataset are already
 * created (either via CDK or CLI). This script creates the analysis + dashboard
 * on top of them.
 *
 * Usage:
 *   npx ts-node scripts/deploy-quicksight.ts
 *
 * Prerequisites:
 *   - AWS CLI configured (set AWS_PROFILE env var or uses "default" profile)
 *   - QuickSight data source and dataset already created
 *   - cdk.json has quickSightUserArn configured
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { buildDashboardDefinition } from '../lib/dashboard-visuals';

// ── Configuration ───────────────────────────────────────────────────────
const AWS_PROFILE = process.env.AWS_PROFILE || 'default';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const DATASET_ID = 'kiro-user-dashboard-dataset';
const ANALYSIS_ID = 'kiro-user-dashboard-analysis';
const DASHBOARD_ID = 'kiro-user-dashboard';

function awsCli(cmd: string): string {
  const full = `aws ${cmd} --profile ${AWS_PROFILE} --region ${AWS_REGION}`;
  console.log(`> ${full}`);
  try {
    return execSync(full, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  } catch (err: any) {
    console.error(`CLI error: ${err.stderr || err.message}`);
    throw err;
  }
}

function getAccountId(): string {
  const out = awsCli('sts get-caller-identity --query Account --output text');
  return out.trim();
}

function getQuickSightUserArn(accountId: string): string {
  // First check cdk.json for a configured ARN
  const cdkJsonPath = path.join(__dirname, '..', 'cdk.json');
  if (fs.existsSync(cdkJsonPath)) {
    const cdkJson = JSON.parse(fs.readFileSync(cdkJsonPath, 'utf-8'));
    const configuredArn = cdkJson?.context?.quickSightUserArn;
    if (configuredArn && !configuredArn.includes('YOUR_')) {
      return configuredArn;
    }
  }
  // Auto-detect: pick the first ADMIN user
  const out = awsCli(`quicksight list-users --aws-account-id ${accountId} --namespace default`);
  const users = JSON.parse(out)?.UserList || [];
  const admin = users.find((u: any) => u.Role === 'ADMIN' && u.Active && u.Arn && u.Arn !== 'N/A');
  if (!admin) {
    throw new Error('No active QuickSight ADMIN user found. Create one first or set quickSightUserArn in cdk.json.');
  }
  console.log(`Auto-detected QuickSight user: ${admin.UserName} (${admin.Arn})`);
  return admin.Arn;
}

function writeJsonTmp(name: string, data: any): string {
  const tmpDir = path.join(__dirname, '..', '.tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

// ── Build the dashboard definition ──────────────────────────────────────
function buildDefinition(accountId: string) {
  const def = buildDashboardDefinition(DATASET_ID);
  const DATASET_ARN = `arn:aws:quicksight:${AWS_REGION}:${accountId}:dataset/${DATASET_ID}`;
  // Replace placeholder ARN with real one
  def.DataSetIdentifierDeclarations[0].DataSetArn = DATASET_ARN;
  return def;
}

// ── Check if resource exists ────────────────────────────────────────────
function analysisExists(accountId: string): boolean {
  try {
    const out = awsCli(`quicksight describe-analysis --aws-account-id ${accountId} --analysis-id ${ANALYSIS_ID}`);
    const desc = JSON.parse(out);
    const status = desc?.Analysis?.Status;
    // Treat DELETED or CREATION_FAILED as non-existent for update purposes
    return status !== 'DELETED' && status !== undefined;
  } catch {
    return false;
  }
}

function dashboardExists(accountId: string): boolean {
  try {
    awsCli(`quicksight describe-dashboard --aws-account-id ${accountId} --dashboard-id ${DASHBOARD_ID}`);
    return true;
  } catch {
    return false;
  }
}

// ── Create or Update Analysis ───────────────────────────────────────────
function deployAnalysis(accountId: string, qsUserArn: string, definition: any) {
  const defFile = writeJsonTmp('analysis-definition.json', definition);

  const permissions = [
    {
      Principal: qsUserArn,
      Actions: [
        'quicksight:RestoreAnalysis',
        'quicksight:UpdateAnalysisPermissions',
        'quicksight:DeleteAnalysis',
        'quicksight:DescribeAnalysisPermissions',
        'quicksight:QueryAnalysis',
        'quicksight:DescribeAnalysis',
        'quicksight:UpdateAnalysis',
      ],
    },
  ];
  const permFile = writeJsonTmp('analysis-permissions.json', permissions);

  if (analysisExists(accountId)) {
    console.log('\n📝 Updating existing analysis...');
    awsCli(
      `quicksight update-analysis` +
      ` --aws-account-id ${accountId}` +
      ` --analysis-id ${ANALYSIS_ID}` +
      ` --name "Kiro User Dashboard Analysis"` +
      ` --definition file://${defFile}`,
    );
  } else {
    console.log('\n🆕 Creating analysis...');
    awsCli(
      `quicksight create-analysis` +
      ` --aws-account-id ${accountId}` +
      ` --analysis-id ${ANALYSIS_ID}` +
      ` --name "Kiro User Dashboard Analysis"` +
      ` --definition file://${defFile}` +
      ` --permissions file://${permFile}`,
    );
  }
  console.log('✅ Analysis deployed.');
}

// ── Create or Update Dashboard ──────────────────────────────────────────
function deployDashboard(accountId: string, qsUserArn: string, definition: any) {
  const defFile = writeJsonTmp('dashboard-definition.json', definition);

  const permissions = [
    {
      Principal: qsUserArn,
      Actions: [
        'quicksight:DescribeDashboard',
        'quicksight:ListDashboardVersions',
        'quicksight:UpdateDashboardPermissions',
        'quicksight:QueryDashboard',
        'quicksight:UpdateDashboard',
        'quicksight:DeleteDashboard',
        'quicksight:DescribeDashboardPermissions',
        'quicksight:UpdateDashboardPublishedVersion',
      ],
    },
  ];
  const permFile = writeJsonTmp('dashboard-permissions.json', permissions);

  if (dashboardExists(accountId)) {
    console.log('\n📝 Updating existing dashboard...');
    awsCli(
      `quicksight update-dashboard` +
      ` --aws-account-id ${accountId}` +
      ` --dashboard-id ${DASHBOARD_ID}` +
      ` --name "Kiro User Dashboard"` +
      ` --definition file://${defFile}`,
    );
  } else {
    console.log('\n🆕 Creating dashboard...');
    awsCli(
      `quicksight create-dashboard` +
      ` --aws-account-id ${accountId}` +
      ` --dashboard-id ${DASHBOARD_ID}` +
      ` --name "Kiro User Dashboard"` +
      ` --definition file://${defFile}` +
      ` --permissions file://${permFile}`,
    );
  }

  // Publish the latest version
  try {
    const listOut = awsCli(
      `quicksight list-dashboard-versions --aws-account-id ${accountId} --dashboard-id ${DASHBOARD_ID}`,
    );
    const versions = JSON.parse(listOut)?.DashboardVersionSummaryList || [];
    const latestVersion = Math.max(...versions.map((v: any) => v.VersionNumber));
    if (latestVersion > 0) {
      awsCli(
        `quicksight update-dashboard-published-version` +
        ` --aws-account-id ${accountId}` +
        ` --dashboard-id ${DASHBOARD_ID}` +
        ` --version-number ${latestVersion}`,
      );
    }
  } catch (e) {
    console.warn('⚠️  Could not auto-publish dashboard version. You may need to publish manually.');
  }

  console.log('✅ Dashboard deployed.');
  console.log(`\n🔗 Dashboard URL: https://${AWS_REGION}.quicksight.aws.amazon.com/sn/dashboards/${DASHBOARD_ID}`);
}

// ── Main ────────────────────────────────────────────────────────────────
function main() {
  console.log('🚀 Kiro User Dashboard - QuickSight Deployment');
  console.log('================================================\n');

  const accountId = getAccountId();
  console.log(`AWS Account: ${accountId}\n`);

  const qsUserArn = getQuickSightUserArn(accountId);
  console.log(`QuickSight User: ${qsUserArn}\n`);

  // Verify dataset exists
  try {
    awsCli(`quicksight describe-data-set --aws-account-id ${accountId} --data-set-id ${DATASET_ID}`);
    console.log('✅ Dataset found.\n');
  } catch {
    console.error('❌ Dataset not found. Deploy the CDK stack first, then create the dataset.');
    console.error(`   Expected dataset ID: ${DATASET_ID}`);
    process.exit(1);
  }

  const definition = buildDefinition(accountId);

  // Write the full definition for reference
  writeJsonTmp('full-definition.json', definition);
  console.log('📄 Full definition written to .tmp/full-definition.json\n');

  deployAnalysis(accountId, qsUserArn, definition);
  deployDashboard(accountId, qsUserArn, definition);

  console.log('\n================================================');
  console.log('🎉 Deployment complete!');
  console.log(`   Analysis ID:  ${ANALYSIS_ID}`);
  console.log(`   Dashboard ID: ${DASHBOARD_ID}`);
}

main();
