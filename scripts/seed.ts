#!/usr/bin/env npx tsx
/**
 * Seed script for local/dev testing.
 *
 * Usage:
 *   npx tsx scripts/seed.ts --region us-east-1 --stack-name MusicMcp-dev [--music-user-token TOKEN]
 *
 * What it does:
 *   1. Reads CloudFormation stack outputs to discover table names and KMS key ARN
 *   2. Generates a new API key (mmc_<random>)
 *   3. Creates a user in UsersTable
 *   4. Writes the hashed API key record to ApiKeysTable
 *   5. Optionally encrypts and stores an Apple Music user token in UserMusicTokensTable
 *   6. Prints the raw API key to the console (shown once)
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { KMSClient, EncryptCommand } from '@aws-sdk/client-kms';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    region: { type: 'string', default: 'us-east-1' },
    'stack-name': { type: 'string' },
    'music-user-token': { type: 'string' },
  },
  strict: true,
});

const region = args.region!;
const stackName = args['stack-name'];
const musicUserToken = args['music-user-token'];

if (!stackName) {
  console.error('Usage: npx tsx scripts/seed.ts --region <region> --stack-name <stack> [--music-user-token TOKEN]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Key generation helpers (inlined from packages/server/src/auth/api-key.ts)
// ---------------------------------------------------------------------------

const API_KEY_PREFIX = 'mmc_';

function generateApiKey(): { rawKey: string; keyHash: string } {
  const randomPart = randomBytes(16).toString('hex');
  const rawKey = `${API_KEY_PREFIX}${randomPart}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  return { rawKey, keyHash };
}

// ---------------------------------------------------------------------------
// Resolve CloudFormation stack outputs
// ---------------------------------------------------------------------------

interface StackOutputs {
  apiUrl: string;
  usersTableName: string;
  apiKeysTableName: string;
  userMusicTokensTableName: string;
  tokenEncryptionKeyArn: string;
}

async function getStackOutputs(cfnClient: CloudFormationClient, stack: string): Promise<StackOutputs> {
  const { Stacks } = await cfnClient.send(
    new DescribeStacksCommand({ StackName: stack }),
  );

  if (!Stacks || Stacks.length === 0) {
    throw new Error(`Stack "${stack}" not found`);
  }

  const outputs = Stacks[0].Outputs ?? [];
  const get = (key: string): string => {
    const match = outputs.find((o) => o.OutputKey === key);
    if (!match?.OutputValue) {
      throw new Error(`Stack output "${key}" not found in stack "${stack}"`);
    }
    return match.OutputValue;
  };

  return {
    apiUrl: get('ApiUrl'),
    usersTableName: get('UsersTableName'),
    apiKeysTableName: get('ApiKeysTableName'),
    userMusicTokensTableName: get('UserMusicTokensTableName'),
    tokenEncryptionKeyArn: get('TokenEncryptionKeyArn'),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Resolving stack outputs for "${stackName}" in ${region}...`);

  const cfnClient = new CloudFormationClient({ region });
  const stackOutputs = await getStackOutputs(cfnClient, stackName!);

  console.log('Stack outputs resolved:');
  console.log(`  API URL:                   ${stackOutputs.apiUrl}`);
  console.log(`  UsersTable:                ${stackOutputs.usersTableName}`);
  console.log(`  ApiKeysTable:              ${stackOutputs.apiKeysTableName}`);
  console.log(`  UserMusicTokensTable:      ${stackOutputs.userMusicTokensTableName}`);
  console.log(`  TokenEncryptionKeyArn:     ${stackOutputs.tokenEncryptionKeyArn}`);

  const ddbDocClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region }),
  );

  const userId = randomUUID();
  const now = new Date().toISOString();
  const { rawKey, keyHash } = generateApiKey();

  // 1. Create user record
  console.log('\nCreating user record...');
  await ddbDocClient.send(
    new PutCommand({
      TableName: stackOutputs.usersTableName,
      Item: {
        userId,
        email: 'seed@test.local',
        createdAt: now,
        plan: 'dev',
      },
    }),
  );
  console.log(`  userId: ${userId}`);

  // 2. Create API key record
  console.log('Creating API key record...');
  await ddbDocClient.send(
    new PutCommand({
      TableName: stackOutputs.apiKeysTableName,
      Item: {
        keyHash,
        userId,
        keyPrefix: rawKey.slice(0, 8),
        name: 'seed-key',
        createdAt: now,
        lastUsedAt: now,
        isActive: true,
      },
    }),
  );
  console.log(`  keyPrefix: ${rawKey.slice(0, 8)}`);

  // 3. Optionally store encrypted Apple Music user token
  if (musicUserToken) {
    console.log('Encrypting and storing Apple Music user token...');
    const kmsClient = new KMSClient({ region });
    const { CiphertextBlob } = await kmsClient.send(
      new EncryptCommand({
        KeyId: stackOutputs.tokenEncryptionKeyArn,
        Plaintext: Buffer.from(musicUserToken),
      }),
    );

    if (!CiphertextBlob) {
      throw new Error('KMS encryption returned no ciphertext');
    }

    const encryptedToken = Buffer.from(CiphertextBlob).toString('base64');

    await ddbDocClient.send(
      new PutCommand({
        TableName: stackOutputs.userMusicTokensTableName,
        Item: {
          userId,
          service: 'apple_music',
          encryptedToken,
          connectedAt: now,
          updatedAt: now,
        },
      }),
    );
    console.log('  Apple Music token stored.');
  }

  // 4. Print results
  console.log('\n========================================');
  console.log('Seed complete!');
  console.log('========================================');
  console.log(`User ID:   ${userId}`);
  console.log(`API Key:   ${rawKey}`);
  console.log(`API URL:   ${stackOutputs.apiUrl}`);
  console.log('========================================');
  console.log('Save the API key above — it will not be shown again.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
