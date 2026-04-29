#!/usr/bin/env node
import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
import { MixcraftStack } from './stacks/mixcraft-stack.js';

const app = new cdk.App();
const environment = (app.node.tryGetContext('environment') as string) || 'dev';
const clerkPublishableKey =
  (app.node.tryGetContext('clerkPublishableKey') as string) || '';
const domainName =
  (app.node.tryGetContext('domainName') as string) || 'mixcraft.app';
const clerkOauthAuthorizeUrl =
  (app.node.tryGetContext('clerkOauthAuthorizeUrl') as string) ||
  `https://clerk.${domainName}/oauth/authorize`;
const clerkOauthTokenUrl =
  (app.node.tryGetContext('clerkOauthTokenUrl') as string) ||
  `https://clerk.${domainName}/oauth/token`;

// Spotify support is gated behind a deploy-time flag because Spotify's
// developer program restricts apps to an allowlist that cannot be
// expanded for public distribution. Hosted mixcraft.app deploys with this
// off (Apple Music only); self-hosters flip it on after registering their
// own Spotify dev app. See docs/SELF-HOSTING.md.
const enableSpotifyContext = app.node.tryGetContext('enableSpotify');
const enableSpotify =
  enableSpotifyContext === true || enableSpotifyContext === 'true';

new MixcraftStack(app, `Mixcraft-${environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  environment,
  domainName,
  clerkPublishableKey,
  enableSpotify,
  appleTeamIdSecretName: `mixcraft/${environment}/apple-team-id`,
  appleKeyIdSecretName: `mixcraft/${environment}/apple-key-id`,
  applePrivateKeySecretName: `mixcraft/${environment}/apple-private-key`,
  clerkSecretKeyName: `mixcraft/${environment}/clerk-secret-key`,
  clerkWebhookSecretName: `mixcraft/${environment}/clerk-webhook-secret`,
  clerkOauthAuthorizeUrl,
  clerkOauthTokenUrl,
  spotifyClientIdSecretName: `mixcraft/${environment}/spotify-client-id`,
  spotifyClientSecretSecretName: `mixcraft/${environment}/spotify-client-secret`,
  alertEmail: process.env.ALERT_EMAIL || '',
});
