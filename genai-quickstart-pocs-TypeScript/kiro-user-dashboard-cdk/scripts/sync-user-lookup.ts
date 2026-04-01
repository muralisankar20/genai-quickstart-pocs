#!/usr/bin/env npx ts-node
/**
 * Syncs Identity Center users to a CSV lookup file in S3.
 * This creates a mapping table: userid → display_name, username, email
 *
 * The CSV includes both bare UUID and directory-prefixed userid formats
 * so it can join with either format found in the source data.
 *
 * Auto-detects: AWS account ID, Identity Store ID, S3 bucket name.
 *
 * Usage:
 *   npx ts-node scripts/sync-user-lookup.ts
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const AWS_PROFILE = process.env.AWS_PROFILE || 'default';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const S3_KEY = 'user-lookup/user_lookup.csv';

function awsCli(cmd: string): string {
  const full = `aws ${cmd} --profile ${AWS_PROFILE} --region ${AWS_REGION}`;
  return execSync(full, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
}

function getAccountId(): string {
  const out = awsCli('sts get-caller-identity --query Account --output text');
  return out.trim();
}

function getIdentityStoreId(): string {
  const out = awsCli('sso-admin list-instances');
  const instances = JSON.parse(out)?.Instances || [];
  if (instances.length === 0) {
    throw new Error('No SSO instances found. Ensure Identity Center is configured in this account/region.');
  }
  const storeId = instances[0].IdentityStoreId;
  console.log(`Auto-detected Identity Store ID: ${storeId}`);
  return storeId;
}

function getS3Bucket(accountId: string): string {
  return `kiro-user-dashboard-athena-results-${accountId}-${AWS_REGION}`;
}

function main() {
  console.log('🔄 Syncing Identity Center users to S3 lookup table...\n');

  const accountId = getAccountId();
  console.log(`AWS Account: ${accountId}`);

  const identityStoreId = getIdentityStoreId();
  const s3Bucket = getS3Bucket(accountId);
  console.log(`S3 Bucket: ${s3Bucket}\n`);

  // Fetch all users from Identity Center
  const out = awsCli(`identitystore list-users --identity-store-id ${identityStoreId}`);
  const users = JSON.parse(out).Users || [];

  console.log(`Found ${users.length} users in Identity Center.\n`);

  // Build CSV with both userid formats
  const rows: string[] = ['userid,display_name,username,email'];

  for (const user of users) {
    const userId = user.UserId;
    const displayName = (user.DisplayName || '').replace(/,/g, ' ');
    const username = (user.UserName || '').replace(/,/g, ' ');
    const email = user.Emails?.[0]?.Value || '';

    // Bare UUID format
    rows.push(`${userId},${displayName},${username},${email}`);

    // Directory-prefixed format (d-XXXXXXXXXX.UUID)
    rows.push(`${identityStoreId}.${userId},${displayName},${username},${email}`);

    // Quoted UUID format (some source data has quotes)
    rows.push(`"${userId}",${displayName},${username},${email}`);

    console.log(`  ${displayName} (${username}) → ${userId}`);
  }

  const csv = rows.join('\n') + '\n';

  // Write to temp file and upload to S3
  const tmpFile = '/tmp/user_lookup.csv';
  fs.writeFileSync(tmpFile, csv);

  console.log(`\n📤 Uploading to s3://${s3Bucket}/${S3_KEY}...`);
  awsCli(`s3 cp ${tmpFile} s3://${s3Bucket}/${S3_KEY}`);

  console.log('✅ User lookup table synced to S3.');
  console.log(`\n   Location: s3://${s3Bucket}/${S3_KEY}`);
  console.log(`   Rows: ${rows.length - 1} (${users.length} users × 3 formats)`);
}

main();
