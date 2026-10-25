---
name: gmail-multi
description: Manage, search, read, draft, and send emails across multiple Gmail accounts in a single conversation. Use when the user asks to check their inboxes, find emails across accounts, draft replies, send messages, download attachments, or manage labels across one or more Gmail accounts.
---

# Multi-Account Gmail (`gmail-multi`)

This skill provides multi-account Gmail management through the `gmail-multi-mcp` server. It supports managing up to dozens of separate personal, work, and project inboxes simultaneously in a single conversation.

## Operational Rules & Safety Guidelines

### 1. Account Resolution & Identity Protection
- Every operation (except `list_accounts` and `search_emails` with `account="all"`) requires an `account` parameter.
- The `account` parameter accepts either the **alias** (e.g., `"personal"`, `"work"`) or the **actual email address** (e.g., `"you@gmail.com"`).
- **Cross-account reply safety**: When replying to an email or thread, **always verify that the `account` used to reply matches the account that received the email**. Never send a reply to a work email using a personal account, or vice-versa, unless explicitly requested by the user.
- If unsure which account the user refers to, call `list_accounts` first to check the registered aliases and email addresses.

### 2. Sending Emails & Safety Confirmations
- `send_email` immediately delivers an email to real recipients. Invitations and messages cannot be un-sent.
- **Always confirm with the user before sending**:
  - Show the chosen **From Account / Email**
  - Show the **To / Cc / Bcc Recipients**
  - Show the **Subject** and a preview of the **Body**
  - Wait for explicit user confirmation before calling `send_email`.
- If an account is set to `draft` permission, respect the security policy and use `create_draft` instead of attempting `send_email`.

### 3. Parallel Cross-Account Searches
- When the user asks "Find my emails about X", "Check if I got a receipt for Y", or "What unread emails do I have?", pass `account="all"` to `search_emails`.
- The MCP server will query all registered accounts concurrently and return unified results sorted chronologically.

### 4. Trash vs. Permanent Delete
- The MCP server only exposes `trash_email` (which moves messages to Gmail Trash for 30-day recovery).
- Never claim an email is permanently deleted; clarify that it has been moved to the Trash.

### 5. Attachments
- Use `download_attachment` when the user asks to save an incoming file from an email. Always specify a valid local destination directory.
- Use the `attachments` array in `create_draft` or `send_email` when the user wants to attach local files to an outgoing message.
