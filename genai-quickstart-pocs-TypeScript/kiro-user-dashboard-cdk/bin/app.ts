#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { DashboardStack } from '../lib/dashboard-stack';

const app = new cdk.App();

// Read parameters from cdk.json context
const sourceBucketName = app.node.tryGetContext('sourceBucketName');
const sourceBucketPrefix = app.node.tryGetContext('sourceBucketPrefix');
const dataFormat = app.node.tryGetContext('dataFormat');
const crawlerSchedule = app.node.tryGetContext('crawlerSchedule') || 'cron(30 1 * * ? *)';
const queryMode = app.node.tryGetContext('queryMode') || 'DirectQuery';

// Validate required parameters
if (!sourceBucketName) {
  throw new Error('sourceBucketName is required in cdk.json context');
}
if (!sourceBucketPrefix) {
  throw new Error('sourceBucketPrefix is required in cdk.json context');
}
if (!dataFormat) {
  throw new Error('dataFormat is required in cdk.json context');
}

new DashboardStack(app, 'KiroUserDashboardStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1'
  },
  sourceBucketName,
  sourceBucketPrefix,
  dataFormat,
  crawlerSchedule,
  queryMode
});

// Run AWS Solutions security checks at synth time
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
