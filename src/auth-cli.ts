import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { google } from 'googleapis';
import { AccountPermission, AccountConfig } from './types.js';
import {
  getBaseDir,
  loadRegistry,
  saveRegistry,
  loadOAuthKeys,
  getDefaultOAuthKeyPath,
} from './config.js';

function openBrowser(targetUrl: string) {
  const platform = process.platform;
  let cmd = '';
  if (platform === 'darwin') {
    cmd = `open "${targetUrl}"`;
  } else if (platform === 'win32') {
    cmd = `start "" "${targetUrl}"`;
  } else {
    cmd = `xdg-open "${targetUrl}"`;
  }
  exec(cmd, (err) => {
    if (err) {
      console.log(`\nCould not open browser automatically. Please open this URL manually:\n${targetUrl}\n`);
    }
  });
}

const SCOPES_MAP: Record<AccountPermission, string[]> = {
  readonly: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  draft: [
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  full: [
    'https://mail.google.com/',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
};

export async function handleAuthAdd(options: {
  alias: string;
  permission?: AccountPermission;
  oauthKeys?: string;
}): Promise<void> {
  const alias = options.alias.trim();
  if (!alias) {
    console.error('Error: alias is required (e.g., "personal", "work")');
    process.exit(1);
  }

  const permission = options.permission || 'full';
  const customOAuthKeys = options.oauthKeys ? path.resolve(options.oauthKeys) : undefined;
  const creds = loadOAuthKeys(customOAuthKeys);

  console.log(`\nSetting up Gmail account with alias: "${alias}" (Permission: ${permission})...`);

  // Start loopback HTTP server
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind local callback server');
  }
  const port = address.port;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    redirectUri
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES_MAP[permission],
  });

  console.log(`\nOpening browser for Google Sign-in:\n${authUrl}\n`);
  openBrowser(authUrl);

  const code = await new Promise<string>((resolve, reject) => {
    server.on('request', async (req, res) => {
      try {
        const parsedUrl = url.parse(req.url || '', true);
        if (parsedUrl.pathname === '/oauth2callback') {
          const authCode = parsedUrl.query.code as string;
          const authError = parsedUrl.query.error as string;

          if (authError) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h2>Authentication Failed</h2><p>${authError}</p>`);
            server.close();
            reject(new Error(`OAuth Error: ${authError}`));
            return;
          }

          if (authCode) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                  <h2 style="color: #10b981;">✓ Authentication Successful!</h2>
                  <p>You can close this tab and return to your terminal.</p>
                </body>
              </html>
            `);
            server.close();
            resolve(authCode);
            return;
          }
        }
        res.writeHead(404);
        res.end();
      } catch (e) {
        server.close();
        reject(e);
      }
    });
  });

  console.log('Exchanging authorization code for tokens...');
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Fetch real email profile
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const profileRes = await gmail.users.getProfile({ userId: 'me' });
  const userEmail = profileRes.data.emailAddress || `${alias}@unknown`;

  // Save token file with 0600 permissions
  const tokenFilename = `${alias}.json`;
  const tokenPath = path.join(getBaseDir(), 'tokens', tokenFilename);
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });

  // Update accounts registry
  const registry = loadRegistry();
  const accountConfig: AccountConfig = {
    alias,
    email: userEmail,
    permission,
    tokenPath,
    oauthKeyPath: customOAuthKeys,
    addedAt: new Date().toISOString(),
  };

  registry.accounts[alias] = accountConfig;
  saveRegistry(registry);

  console.log(`\n✓ Successfully connected account!`);
  console.log(`  Alias:      ${alias}`);
  console.log(`  Email:      ${userEmail}`);
  console.log(`  Permission: ${permission}`);
  console.log(`  Token:      ${tokenPath}`);
  console.log(`\nThis account is now immediately available in your MCP tools without restarting.`);
}

export function handleAuthList(): void {
  const registry = loadRegistry();
  const accounts = Object.values(registry.accounts);

  console.log(`\n--- Registered Gmail Accounts (${accounts.length}) ---`);
  if (accounts.length === 0) {
    console.log('No accounts registered yet.');
    console.log('Run "npx gmail-multi-mcp auth add <alias>" to connect an account.\n');
    return;
  }

  console.log('');
  console.log(
    'ALIAS'.padEnd(16) +
    'EMAIL'.padEnd(32) +
    'PERMISSION'.padEnd(14) +
    'ADDED'
  );
  console.log('-'.repeat(75));

  for (const acct of accounts) {
    console.log(
      acct.alias.padEnd(16) +
      acct.email.padEnd(32) +
      acct.permission.padEnd(14) +
      new Date(acct.addedAt).toLocaleDateString()
    );
  }
  console.log('');
}

export function handleAuthSetPermission(alias: string, permission: string): void {
  const validPermissions: AccountPermission[] = ['readonly', 'draft', 'full'];
  if (!validPermissions.includes(permission as AccountPermission)) {
    console.error(`Error: invalid permission "${permission}". Must be one of: ${validPermissions.join(', ')}`);
    process.exit(1);
  }

  const registry = loadRegistry();
  const acct = registry.accounts[alias];
  if (!acct) {
    console.error(`Error: account with alias "${alias}" not found.`);
    process.exit(1);
  }

  acct.permission = permission as AccountPermission;
  saveRegistry(registry);
  console.log(`✓ Updated permission for "${alias}" (${acct.email}) to: ${permission}`);
}

export function handleAuthRemove(alias: string): void {
  const registry = loadRegistry();
  const acct = registry.accounts[alias];
  if (!acct) {
    console.error(`Error: account with alias "${alias}" not found.`);
    process.exit(1);
  }

  if (fs.existsSync(acct.tokenPath)) {
    try {
      fs.unlinkSync(acct.tokenPath);
    } catch {
      // ignore
    }
  }

  delete registry.accounts[alias];
  saveRegistry(registry);
  console.log(`✓ Removed account "${alias}" (${acct.email}) and its token.`);
}
