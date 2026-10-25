#!/usr/bin/env npx tsx
/**
 * Upload secrets to SSM Parameter Store (SecureString) for MixCraft.
 *
 * Each value is written to /mixcraft/<env>/<name>, the path the CDK stack reads.
 *
 * Usage:
 *   npx tsx scripts/upload-secrets.ts \
 *     --env prod --region us-east-1 \
 *     --apple-team-id TEAMID \
 *     --apple-key-id KEYID \
 *     --apple-private-key-file ./AuthKey.p8 \
 *     --clerk-secret-key sk_live_... \
 *     --clerk-webhook-secret whsec_...
 *
 * Options:
 *   --env                     Environment name, as passed to `cdk deploy -c environment=<env>` [required]
 *   --region                  AWS region (default: us-east-1)
 *   --apple-team-id           Apple Developer Team ID
 *   --apple-key-id            Apple Music Key ID
 *   --apple-private-key-file  Path to Apple Music private key (.p8 file)
 *   --apple-private-key       Apple Music private key as raw string
 *   --clerk-secret-key        Clerk secret key
 *   --clerk-webhook-secret    Clerk webhook signing secret
 *   --spotify-client-id       Spotify Client ID (optional, only with enableSpotify=true)
 *   --spotify-client-secret   Spotify Client Secret (optional, only with enableSpotify=true)
 *   --dry-run                 Preview actions without writing to Parameter Store
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    env: { type: 'string' },
    region: { type: 'string', default: 'us-east-1' },
    'apple-team-id': { type: 'string' },
    'apple-key-id': { type: 'string' },
    'apple-private-key-file': { type: 'string' },
    'apple-private-key': { type: 'string' },
    'clerk-secret-key': { type: 'string' },
    'clerk-webhook-secret': { type: 'string' },
    'spotify-client-id': { type: 'string' },
    'spotify-client-secret': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: true,
});

const env = args.env;
const region = args.region!;
const dryRun = args['dry-run']!;

if (!env || !/^[A-Za-z0-9_.-]+$/.test(env)) {
  console.error('Usage: npx tsx scripts/upload-secrets.ts --env <env> [options]');
  console.error('  --env is required: the environment name passed to cdk deploy -c environment=<env>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Resolve parameter values
// ---------------------------------------------------------------------------

interface ParameterEntry {
  name: string;
  value: string;
}

const parameters: ParameterEntry[] = [];

function add(name: string, value: string | undefined): void {
  if (value) {
    parameters.push({ name: `/mixcraft/${env}/${name}`, value });
  }
}

add('apple-team-id', args['apple-team-id']);
add('apple-key-id', args['apple-key-id']);

if (args['apple-private-key-file']) {
  add('apple-private-key', readFileSync(args['apple-private-key-file'], 'utf-8'));
} else {
  add('apple-private-key', args['apple-private-key']);
}

add('clerk-secret-key', args['clerk-secret-key']);
add('clerk-webhook-secret', args['clerk-webhook-secret']);
add('spotify-client-id', args['spotify-client-id']);
add('spotify-client-secret', args['spotify-client-secret']);

if (parameters.length === 0) {
  console.error('No secrets provided. Pass at least one secret flag.');
  console.error('Available flags: --apple-team-id, --apple-key-id, --apple-private-key-file,');
  console.error('  --apple-private-key, --clerk-secret-key, --clerk-webhook-secret,');
  console.error('  --spotify-client-id, --spotify-client-secret');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Upload parameters
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Environment: ${env}`);
  console.log(`Region:      ${region}`);
  console.log(`Parameters:  ${parameters.length}`);
  if (dryRun) {
    console.log('\n[DRY RUN] No changes will be written.\n');
  }
  console.log('');

  const client = new SSMClient({ region });

  for (const parameter of parameters) {
    const preview = parameter.value.length > 20
      ? `${parameter.value.slice(0, 10)}...${parameter.value.slice(-4)}`
      : '***';

    if (dryRun) {
      console.log(`  [dry-run] ${parameter.name} → ${preview}`);
    } else {
      // Overwrite makes this an upsert: it creates the parameter or replaces its value.
      const result = await client.send(
        new PutParameterCommand({
          Name: parameter.name,
          Value: parameter.value,
          Type: 'SecureString',
          Overwrite: true,
        }),
      );
      console.log(`  Wrote: ${parameter.name} (version ${result.Version})`);
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Upload failed:', err);
  process.exit(1);
});
