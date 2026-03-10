import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.REGION ?? 'us-east-1';

export const ddbDocClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
);
