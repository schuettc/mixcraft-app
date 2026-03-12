#!/usr/bin/env npx tsx
/**
 * Upload secrets to AWS Secrets Manager for MixCraft.
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
 *   --env                     Environment (dev/prod) [required]
 *   --region                  AWS region (default: us-east-1)
 *   --apple-team-id           Apple Developer Team ID
 *   --apple-key-id            Apple Music Key ID
 *   --apple-private-key-file  Path to Apple Music private key (.p8 file)
 *   --apple-private-key       Apple Music private key as raw string
 *   --clerk-secret-key        Clerk secret key
 *   --clerk-webhook-secret    Clerk webhook signing secret
 *   --dry-run                 Preview actions without writing to Secrets Manager
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import {
  SecretsManagerClient,
  PutSecretValueCommand,
  CreateSecretCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';

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
    'dry-run': { type: 'boolean', default: false },
  },
  strict: true,
});

const env = args.env;
const region = args.region!;
const dryRun = args['dry-run']!;

if (!env || !['dev', 'prod'].includes(env)) {
  console.error('Usage: npx tsx scripts/upload-secrets.ts --env <dev|prod> [options]');
  console.error('  --env is required and must be "dev" or "prod"');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Resolve secret values
// ---------------------------------------------------------------------------

interface SecretEntry {
  name: string;
  value: string;
}

const secrets: SecretEntry[] = [];

if (args['apple-team-id']) {
  secrets.push({ name: `mixcraft/${env}/apple-team-id`, value: args['apple-team-id'] });
}

if (args['apple-key-id']) {
  secrets.push({ name: `mixcraft/${env}/apple-key-id`, value: args['apple-key-id'] });
}

if (args['apple-private-key-file']) {
  const keyContent = readFileSync(args['apple-private-key-file'], 'utf-8');
  secrets.push({ name: `mixcraft/${env}/apple-private-key`, value: keyContent });
} else if (args['apple-private-key']) {
  secrets.push({ name: `mixcraft/${env}/apple-private-key`, value: args['apple-private-key'] });
}

if (args['clerk-secret-key']) {
  secrets.push({ name: `mixcraft/${env}/clerk-secret-key`, value: args['clerk-secret-key'] });
}

if (args['clerk-webhook-secret']) {
  secrets.push({ name: `mixcraft/${env}/clerk-webhook-secret`, value: args['clerk-webhook-secret'] });
}

if (secrets.length === 0) {
  console.error('No secrets provided. Pass at least one secret flag.');
  console.error('Available flags: --apple-team-id, --apple-key-id, --apple-private-key-file,');
  console.error('  --apple-private-key, --clerk-secret-key, --clerk-webhook-secret');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Upload secrets
// ---------------------------------------------------------------------------

async function upsertSecret(
  client: SecretsManagerClient,
  name: string,
  value: string,
): Promise<'created' | 'updated'> {
  try {
    await client.send(
      new PutSecretValueCommand({
        SecretId: name,
        SecretString: value,
      }),
    );
    return 'updated';
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      await client.send(
        new CreateSecretCommand({
          Name: name,
          SecretString: value,
        }),
      );
      return 'created';
    }
    throw err;
  }
}

async function main(): Promise<void> {
  console.log(`Environment: ${env}`);
  console.log(`Region:      ${region}`);
  console.log(`Secrets:     ${secrets.length}`);
  if (dryRun) {
    console.log('\n[DRY RUN] No changes will be written.\n');
  }
  console.log('');

  const client = new SecretsManagerClient({ region });

  for (const secret of secrets) {
    const preview = secret.value.length > 20
      ? `${secret.value.slice(0, 10)}...${secret.value.slice(-4)}`
      : '***';

    if (dryRun) {
      console.log(`  [dry-run] ${secret.name} → ${preview}`);
    } else {
      const action = await upsertSecret(client, secret.name, secret.value);
      console.log(`  ${action === 'created' ? 'Created' : 'Updated'}: ${secret.name}`);
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Upload failed:', err);
  process.exit(1);
});
