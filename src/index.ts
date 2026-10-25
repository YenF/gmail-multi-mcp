#!/usr/bin/env node
import {
  handleAuthAdd,
  handleAuthList,
  handleAuthRemove,
  handleAuthSetPermission,
} from './auth-cli.js';
import { runServer } from './server.js';
import { AccountPermission } from './types.js';

function printHelp() {
  console.log(`
gmail-multi-mcp — Multi-account Gmail MCP Server & Auth Manager

USAGE:
  # Start the Model Context Protocol (MCP) server (stdio mode):
  gmail-multi-mcp

  # Manage accounts & authentication:
  gmail-multi-mcp auth add <alias> [options]
  gmail-multi-mcp auth list
  gmail-multi-mcp auth set-permission <alias> <readonly|draft|full>
  gmail-multi-mcp auth remove <alias>

OPTIONS (auth add):
  --permission <level>   Permission level: readonly, draft, or full (default: full)
  --oauth-keys <path>    Path to custom Google Cloud OAuth client keys JSON file

EXAMPLES:
  # Connect personal account (opens browser to sign in):
  npx gmail-multi-mcp auth add personal

  # Connect work account with draft-only safety:
  npx gmail-multi-mcp auth add work --permission draft

  # Connect company account using corporate OAuth client:
  npx gmail-multi-mcp auth add corp --oauth-keys ~/Downloads/corp-oauth.keys.json

  # List all connected accounts:
  npx gmail-multi-mcp auth list
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'start' || args[0] === 'serve') {
    // Run stdio MCP server
    await runServer();
    return;
  }

  const cmd = args[0];

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  if (cmd === 'auth') {
    const subCmd = args[1];

    if (!subCmd || subCmd === 'help' || subCmd === '--help') {
      printHelp();
      return;
    }

    if (subCmd === 'list' || subCmd === 'ls') {
      handleAuthList();
      return;
    }

    if (subCmd === 'add') {
      const alias = args[2];
      if (!alias) {
        console.error('Error: alias is required. Example: npx gmail-multi-mcp auth add personal');
        process.exit(1);
      }

      let permission: AccountPermission = 'full';
      let oauthKeys: string | undefined;

      for (let i = 3; i < args.length; i++) {
        if (args[i] === '--permission' && args[i + 1]) {
          permission = args[i + 1] as AccountPermission;
          i++;
        } else if (args[i] === '--oauth-keys' && args[i + 1]) {
          oauthKeys = args[i + 1];
          i++;
        }
      }

      await handleAuthAdd({ alias, permission, oauthKeys });
      return;
    }

    if (subCmd === 'set-permission') {
      const alias = args[2];
      const permission = args[3];
      if (!alias || !permission) {
        console.error('Error: alias and permission are required. Example: npx gmail-multi-mcp auth set-permission work draft');
        process.exit(1);
      }
      handleAuthSetPermission(alias, permission);
      return;
    }

    if (subCmd === 'remove' || subCmd === 'rm') {
      const alias = args[2];
      if (!alias) {
        console.error('Error: alias is required. Example: npx gmail-multi-mcp auth remove work');
        process.exit(1);
      }
      handleAuthRemove(alias);
      return;
    }

    console.error(`Unknown auth command: ${subCmd}`);
    printHelp();
    process.exit(1);
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
