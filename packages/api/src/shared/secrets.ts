import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const REGION = process.env.REGION ?? 'us-east-1';

const ssmClient = new SSMClient({ region: REGION });

const secretsCache = new Map<string, string>();

/**
 * Read a required parameter name from the environment.
 *
 * Callers previously passed `process.env.X!`, so a renamed or missing variable
 * reached the SDK as `undefined` and surfaced as an opaque validation error at
 * the first request that needed it. Failing here names the missing variable.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function getSecret(parameterName: string): Promise<string> {
  const cached = secretsCache.get(parameterName);
  if (cached !== undefined) {
    return cached;
  }

  const data = await ssmClient.send(
    new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true,
    }),
  );

  const value = data.Parameter?.Value;
  if (value === undefined) {
    throw new Error(`Parameter value not found for ${parameterName}`);
  }

  secretsCache.set(parameterName, value);
  return value;
}
