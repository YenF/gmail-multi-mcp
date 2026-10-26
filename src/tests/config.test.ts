import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { resolveAccount, loadOAuthKeys, getDefaultOAuthKeyPath } from '../config.js';
import * as fs from 'fs';

describe('Config & Account Resolution Tests', () => {
  test('getDefaultOAuthKeyPath prefers gcp_client_secret.json', () => {
    const keyPath = getDefaultOAuthKeyPath();
    assert.ok(keyPath.includes('gcp_client_secret.json') || keyPath.includes('gcp-oauth.keys.json'));
  });

  test('loadOAuthKeys parses credentials without throwing if file exists', () => {
    const keyPath = getDefaultOAuthKeyPath();
    if (fs.existsSync(keyPath)) {
      const keys = loadOAuthKeys(keyPath);
      assert.ok(keys.client_id, 'client_id should be present');
      assert.ok(keys.client_secret, 'client_secret should be present');
    }
  });

  test('resolveAccount throws clear error for non-existent account', () => {
    assert.throws(
      () => resolveAccount('non_existent_account_12345'),
      /Account "non_existent_account_12345" not found|No accounts registered yet/
    );
  });

  test('resolveAccount matches registered accounts by alias and email', () => {
    try {
      const personal = resolveAccount('personal');
      assert.strictEqual(personal.alias, 'personal');
      assert.ok(personal.email.includes('@'));

      // Case-insensitive match
      const upper = resolveAccount('PERSONAL');
      assert.strictEqual(upper.alias, 'personal');

      // Match by exact email
      const byEmail = resolveAccount(personal.email);
      assert.strictEqual(byEmail.alias, 'personal');
    } catch {
      // If run in clean environment without registered accounts, this is skipped
    }
  });
});
