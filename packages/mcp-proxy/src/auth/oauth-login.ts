import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import type { CachedToken } from './token-cache.js';

const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function computeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function buildAuthorizationUrl(params: {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): { url: string } {
  const challenge = computeCodeChallenge(params.codeVerifier);
  const url = new URL(params.authorizeUrl);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', 'openid profile offline_access');
  return { url: url.toString() };
}

export async function exchangeCodeForToken(params: {
  tokenUrl: string;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<CachedToken> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(params.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function refreshAccessToken(params: {
  tokenUrl: string;
  clientId: string;
  refreshToken: string;
}): Promise<CachedToken> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: params.clientId,
    refresh_token: params.refreshToken,
  });

  const response = await fetch(params.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'start'
      : 'xdg-open';

  const child = spawn(cmd, [url], { stdio: 'ignore', detached: true });
  child.unref();
}

export async function loginViaBrowser(params: {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
}): Promise<CachedToken> {
  const codeVerifier = generateCodeVerifier();
  const { url } = buildAuthorizationUrl({
    authorizeUrl: params.authorizeUrl,
    clientId: params.clientId,
    redirectUri: REDIRECT_URI,
    codeVerifier,
  });

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://localhost:${REDIRECT_PORT}`);

      if (reqUrl.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');

      if (error || !code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication failed</h1><p>You can close this tab.</p>');
        server.close();
        reject(new Error(`OAuth error: ${error ?? 'no code received'}`));
        return;
      }

      try {
        const token = await exchangeCodeForToken({
          tokenUrl: params.tokenUrl,
          clientId: params.clientId,
          code,
          redirectUri: REDIRECT_URI,
          codeVerifier,
        });

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<h1>Logged in to MixCraft</h1><p>You can close this tab and return to the terminal.</p>',
        );
        server.close();
        resolve(token);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<h1>Token exchange failed</h1><p>Please try again.</p>');
        server.close();
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.error('Opening browser for authentication...');
      openBrowser(url);
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Login timed out. Please try again.'));
    }, 120_000);
  });
}
