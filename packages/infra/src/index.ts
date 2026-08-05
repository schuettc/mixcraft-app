#!/usr/bin/env node
import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
import { MixcraftStack } from './stacks/mixcraft-stack.js';

const app = new cdk.App();
// No default: a bare `cdk deploy` must not create or update an environment by
// accident. Pass the target explicitly, e.g. `-c environment=prod`.
const environment = app.node.tryGetContext('environment') as string | undefined;
if (!environment) {
  throw new Error(
    'Missing CDK context "environment": pass -c environment=<env> (e.g. -c environment=prod).',
  );
}
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
  appleTeamIdParameterName: `/mixcraft/${environment}/apple-team-id`,
  appleKeyIdParameterName: `/mixcraft/${environment}/apple-key-id`,
  applePrivateKeyParameterName: `/mixcraft/${environment}/apple-private-key`,
  clerkSecretKeyParameterName: `/mixcraft/${environment}/clerk-secret-key`,
  clerkWebhookSecretParameterName: `/mixcraft/${environment}/clerk-webhook-secret`,
  clerkOauthAuthorizeUrl,
  clerkOauthTokenUrl,
  spotifyClientIdParameterName: `/mixcraft/${environment}/spotify-client-id`,
  spotifyClientSecretParameterName: `/mixcraft/${environment}/spotify-client-secret`,
  alertEmail: process.env.ALERT_EMAIL || '',
});
