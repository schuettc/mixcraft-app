#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MusicMcpStack } from './stacks/music-mcp-stack.js';

const app = new cdk.App();
const environment = (app.node.tryGetContext('environment') as string) || 'dev';

new MusicMcpStack(app, `MusicMcp-${environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  environment,
  appleTeamIdSecretName: `music-mcp/${environment}/apple-team-id`,
  appleKeyIdSecretName: `music-mcp/${environment}/apple-key-id`,
  applePrivateKeySecretName: `music-mcp/${environment}/apple-private-key`,
});
