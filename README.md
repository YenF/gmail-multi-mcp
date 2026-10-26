# gmail-multi-mcp

> Seamless multi-account Gmail integration for AI assistants via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). Manage 2 to 20+ Gmail accounts concurrently in a single process without context explosion.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green.svg)](https://modelcontextprotocol.io/)

---

## Why gmail-multi-mcp?

Traditional Gmail MCP servers spawn **one background process per account**, duplicating 15–20 tool definitions in your LLM's system prompt for every inbox. With 5 accounts, that's nearly 100 tools cluttering the context window.

`gmail-multi-mcp` provides a **unified multi-account architecture**:

- 🚀 **Single Process for N Accounts:** Runs 1 lightweight process whether you have 2 or 10 accounts. Only 10 tools are registered in your prompt.
- 🔍 **Parallel Cross-Account Search:** Search across all your inboxes at once using `account="all"` (queries all inboxes concurrently with `Promise.allSettled`).
- 🛡️ **Per-Account Permission Tiers:** Set sensitive work inboxes to `draft` (compose only) or `readonly` while keeping personal inboxes on `full` (send allowed).
- 🔄 **Hot-Reloading:** Add new accounts via CLI while your AI assistant is running—new accounts are detected immediately without restarting your client.
- 📎 **Full Attachment Support:** Download attachments to local folders and attach local files to outgoing emails or drafts.
- 🔒 **Zero Third-Party Relays:** Direct communication between your local machine and Google APIs using official SDKs. Tokens are stored locally with strict `0600` permissions.

---

## Quick Start

### 1. Prerequisites & Google Cloud OAuth Setup

To access the Gmail API, you need a Google Cloud OAuth Desktop Client:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project (e.g. `gmail-mcp`).
2. Navigate to **APIs & Services > Library** and enable the **Gmail API**.
3. Go to **APIs & Services > OAuth consent screen**:
   - Choose **External** (or **Internal** if using a Google Workspace organization).
   - Fill in the required app information and add your email addresses as **Test users**.
4. Go to **APIs & Services > Credentials > Create Credentials > OAuth client ID**:
   - Application type: **Desktop app**.
   - Download the generated JSON credentials file.
5. Save the file to the default configuration directory:
   ```bash
   mkdir -p ~/.gmail-multi-mcp
   chmod 700 ~/.gmail-multi-mcp
   mv ~/Downloads/client_secret_*.json ~/.gmail-multi-mcp/gcp-oauth.keys.json
   chmod 600 ~/.gmail-multi-mcp/gcp-oauth.keys.json
   ```

---

### 2. Connect Your Accounts

Use the CLI to connect your accounts. Each command opens a browser tab for one-time Google Sign-in:

```bash
# Connect primary personal account (default: full permissions)
npx gmail-multi-mcp auth add personal

# Connect work account with draft-only safety (cannot send or trash emails)
npx gmail-multi-mcp auth add work --permission draft

# Connect an account using a custom corporate OAuth client JSON
npx gmail-multi-mcp auth add corp --oauth-keys ~/Downloads/corp-oauth.json

# View all connected accounts
npx gmail-multi-mcp auth list
```

---

### 3. Add to Your MCP Client Configuration

#### Antigravity (`~/.gemini/config/mcp_config.json`)
```json
{
  "mcpServers": {
    "gmail-multi": {
      "command": "npx",
      "args": ["-y", "gmail-multi-mcp"]
    }
  }
}
```

#### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "gmail-multi": {
      "command": "npx",
      "args": ["-y", "gmail-multi-mcp"]
    }
  }
}
```

#### Cursor (`Settings > Features > MCP`)
- Name: `gmail-multi`
- Type: `command`
- Command: `npx -y gmail-multi-mcp`

---

## Permission Tiers

Configure permissions per account when adding it or change it anytime:

```bash
npx gmail-multi-mcp auth set-permission work draft
```

| Permission | Search & Read | Download Attachments | Create Drafts | Modify Labels | Send Emails | Trash Emails |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `readonly` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `draft` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `full` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Available Tools

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `list_accounts` | *(none)* | Lists all connected accounts, aliases, real emails, and permission tiers. |
| `search_emails` | `query`, `account` (default: `"all"`), `max_results` | Searches emails with Gmail syntax (`from:`, `is:unread`). Queries all inboxes concurrently if `account="all"`. |
| `read_email` | `account`, `message_id` | Reads email details (headers, text, HTML, attachment list). |
| `read_thread` | `account`, `thread_id` | Reads an entire email thread in chronological order. |
| `download_attachment` | `account`, `message_id`, `attachment_id`, `filename`, `destination_dir` | Downloads an email attachment to a local folder. |
| `create_draft` | `account`, `to`, `subject`, `body`, `cc?`, `bcc?`, `attachments?`, `thread_id?` | Creates a draft email with optional local file attachments. |
| `send_email` | `account`, `to`, `subject`, `body`, `cc?`, `bcc?`, `attachments?`, `thread_id?` | Directly sends an email or replies to a thread (blocked if account is not `full`). |
| `modify_email` | `account`, `message_id`, `add_labels?`, `remove_labels?` | Adds or removes labels (e.g. mark read, archive). Accepts label names or IDs. |
| `trash_email` | `account`, `message_id` | Moves an email to Gmail Trash (recoverable for 30 days). |
| `list_labels` | `account` | Lists all labels in an account. |
| `create_label` | `account`, `name` | Creates a new user label in an account. |

---

## CLI Reference

```bash
# Add a new account
gmail-multi-mcp auth add <alias> [--permission <readonly|draft|full>] [--oauth-keys <path>]

# List all connected accounts
gmail-multi-mcp auth list

# Update account permissions dynamically without re-login
gmail-multi-mcp auth set-permission <alias> <readonly|draft|full>

# Remove an account and delete its local token
gmail-multi-mcp auth remove <alias>
```

---

## Directory Structure & Security

All local tokens and configuration files are stored outside project directories:

```text
~/.gmail-multi-mcp/
├── gcp-oauth.keys.json     # Default OAuth client secret (chmod 0600)
├── accounts.json           # Account registry and metadata (chmod 0600)
└── tokens/                 # Encrypted OAuth refresh tokens per account (chmod 0600)
    ├── personal.json
    └── work.json
```

- **File Permissions:** Created with `0700` (directory) and `0600` (files), ensuring only your local OS user can read them.
- **Custom Location:** Set `GMAIL_MULTI_MCP_DIR=/path/to/custom/dir` to override the default storage directory.

---

## Development

```bash
# Clone the repository
git clone https://github.com/your-username/gmail-multi-mcp.git
cd gmail-multi-mcp

# Install dependencies
npm install

# Build TypeScript
npm run build

# Test CLI
node dist/index.js auth list
```

---

## License

[MIT](LICENSE) © 2026
