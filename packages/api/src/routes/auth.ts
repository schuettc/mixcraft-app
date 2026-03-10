import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { Webhook } from 'svix';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '../shared/dynamo.js';
import { getSecret } from '../shared/secrets.js';

const USERS_TABLE = process.env.USERS_TABLE_NAME ?? '';

interface ClerkWebhookPayload {
  type: string;
  data: {
    id: string;
    email_addresses: Array<{
      email_address: string;
    }>;
  };
}

export async function handleWebhook(
  event: APIGatewayProxyEventV2,
): Promise<{ statusCode: number; body: string }> {
  const svixId = event.headers['svix-id'];
  const svixTimestamp = event.headers['svix-timestamp'];
  const svixSignature = event.headers['svix-signature'];
  const webhookSecret = await getSecret(process.env.CLERK_WEBHOOK_SECRET_NAME!);

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing svix headers' }) };
  }

  const body = event.body ?? '';

  let payload: ClerkWebhookPayload;
  try {
    const wh = new Webhook(webhookSecret);
    payload = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkWebhookPayload;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid webhook signature' }) };
  }

  if (payload.type === 'user.created') {
    const userId = payload.data.id;
    const email = payload.data.email_addresses?.[0]?.email_address ?? '';

    await ddbDocClient.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: {
          userId,
          email,
          createdAt: new Date().toISOString(),
          plan: 'free',
        },
      }),
    );
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
}
