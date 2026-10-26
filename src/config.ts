import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AccountConfig, AccountsRegistry } from './types.js';

export function getBaseDir(): string {
  const dir = process.env.GMAIL_MULTI_MCP_DIR || path.join(os.homedir(), '.gmail-multi-mcp');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const tokensDir = path.join(dir, 'tokens');
  if (!fs.existsSync(tokensDir)) {
    fs.mkdirSync(tokensDir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function getDefaultOAuthKeyPath(): string {
  const preferred = path.join(getBaseDir(), 'gcp_client_secret.json');
  if (fs.existsSync(preferred)) {
    return preferred;
  }
  // Backwards compatibility with gcp-oauth.keys.json
  return path.join(getBaseDir(), 'gcp-oauth.keys.json');
}

export function getAccountsJsonPath(): string {
  return path.join(getBaseDir(), 'accounts.json');
}

let cachedRegistry: AccountsRegistry | null = null;
let lastMtime = 0;

export function loadRegistry(): AccountsRegistry {
  const accountsPath = getAccountsJsonPath();
  if (!fs.existsSync(accountsPath)) {
    const initial: AccountsRegistry = {
      version: 1,
      defaultOAuthKeyPath: getDefaultOAuthKeyPath(),
      accounts: {},
    };
    saveRegistry(initial);
    cachedRegistry = initial;
    lastMtime = fs.statSync(accountsPath).mtimeMs;
    return initial;
  }

  const stat = fs.statSync(accountsPath);
  if (cachedRegistry && stat.mtimeMs === lastMtime) {
    return cachedRegistry;
  }

  try {
    const raw = fs.readFileSync(accountsPath, 'utf-8');
    const parsed = JSON.parse(raw) as AccountsRegistry;
    cachedRegistry = parsed;
    lastMtime = stat.mtimeMs;
    return parsed;
  } catch (err) {
    if (cachedRegistry) return cachedRegistry;
    throw new Error(`Failed to parse accounts registry at ${accountsPath}: ${err}`);
  }
}

export function saveRegistry(registry: AccountsRegistry): void {
  const accountsPath = getAccountsJsonPath();
  const content = JSON.stringify(registry, null, 2);
  fs.writeFileSync(accountsPath, content, { mode: 0o600 });
  cachedRegistry = registry;
  lastMtime = fs.statSync(accountsPath).mtimeMs;
}

export function resolveAccount(identifier: string): AccountConfig {
  const registry = loadRegistry();
  const lower = identifier.trim().toLowerCase();

  // Try matching by alias first
  for (const [alias, acct] of Object.entries(registry.accounts)) {
    if (alias.toLowerCase() === lower) {
      return acct;
    }
  }

  // Try matching by email
  for (const acct of Object.values(registry.accounts)) {
    if (acct.email.toLowerCase() === lower) {
      return acct;
    }
  }

  const available = Object.keys(registry.accounts);
  const msg = available.length === 0
    ? 'No accounts registered yet. Use "npx gmail-multi-mcp auth add <alias>" in your terminal to add one.'
    : `Account "${identifier}" not found. Available accounts: ${available.join(', ')}`;
  throw new Error(msg);
}

export function listAllAccounts(): AccountConfig[] {
  const registry = loadRegistry();
  return Object.values(registry.accounts);
}

export interface OAuthCredentialsFile {
  client_id: string;
  client_secret: string;
  redirect_uris?: string[];
}

export function loadOAuthKeys(customPath?: string): OAuthCredentialsFile {
  const keyPath = customPath || getDefaultOAuthKeyPath();
  if (!fs.existsSync(keyPath)) {
    throw new Error(
      `Google OAuth Desktop client keys file not found at: ${keyPath}\n` +
      `Please download your OAuth client JSON from Google Cloud Console and place it at ${keyPath}`
    );
  }

  const raw = fs.readFileSync(keyPath, 'utf-8');
  const parsed = JSON.parse(raw);
  const creds = parsed.installed || parsed.web;
  if (!creds || !creds.client_id || !creds.client_secret) {
    throw new Error(
      `Invalid OAuth keys file at ${keyPath}. Expected an "installed" or "web" client credentials object with client_id and client_secret.`
    );
  }

  return {
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    redirect_uris: creds.redirect_uris,
  };
}
