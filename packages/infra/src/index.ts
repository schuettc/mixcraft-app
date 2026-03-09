#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MixcraftStack } from './stacks/mixcraft-stack.js';

const app = new cdk.App();
const environment = (app.node.tryGetContext('environment') as string) || 'dev';
const clerkPublishableKey =
  (app.node.tryGetContext('clerkPublishableKey') as string) || '';
const domainName =
  (app.node.tryGetContext('domainName') as string) || 'mixcraft.app';

new MixcraftStack(app, `Mixcraft-${environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  environment,
  domainName,
  clerkPublishableKey,
  appleTeamIdSecretName: `mixcraft/${environment}/apple-team-id`,
  appleKeyIdSecretName: `mixcraft/${environment}/apple-key-id`,
  applePrivateKeySecretName: `mixcraft/${environment}/apple-private-key`,
  clerkSecretKeyName: `mixcraft/${environment}/clerk-secret-key`,
  clerkWebhookSecretName: `mixcraft/${environment}/clerk-webhook-secret`,
});
