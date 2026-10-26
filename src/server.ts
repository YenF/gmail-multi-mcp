import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { listAllAccounts, resolveAccount } from './config.js';
import {
  searchEmails,
  readEmail,
  readThread,
  downloadAttachment,
  createDraft,
  sendEmail,
  modifyEmail,
  trashEmail,
  listLabels,
  createLabel,
} from './gmail-client.js';

export async function runServer(): Promise<void> {
  const server = new McpServer({
    name: 'gmail-multi-mcp',
    version: '1.0.0',
  });

  // 1. list_accounts
  server.tool(
    'list_accounts',
    'List all registered Gmail accounts, their aliases, real email addresses, and permission levels (readonly, draft, or full).',
    {},
    async () => {
      const accounts = listAllAccounts();
      if (accounts.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No Gmail accounts registered yet. Run "npx gmail-multi-mcp auth add <alias>" in your terminal to connect an account.',
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              accounts.map((a) => ({
                alias: a.alias,
                email: a.email,
                permission: a.permission,
                addedAt: a.addedAt,
              })),
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // 2. search_emails
  server.tool(
    'search_emails',
    'Search emails using Gmail query syntax (e.g. "from:boss", "is:unread", "subject:invoice"). Can search a single account, an array of accounts, or "all" registered inboxes simultaneously in parallel.',
    {
      query: z.string().describe('Standard Gmail search query (e.g., "is:unread label:important", "from:user@example.com")'),
      account: z.string().default('all').describe('Account alias, email address, or "all" to search all registered accounts in parallel.'),
      max_results: z.number().default(10).describe('Maximum number of results to return per account (default 10).'),
    },
    async ({ query, account, max_results }) => {
      try {
        const results = await searchEmails(account, query, max_results);
        return {
          content: [
            {
              type: 'text',
              text: results.length === 0
                ? `No emails found matching query: "${query}"`
                : JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Search error: ${err.message}` }],
        };
      }
    }
  );

  // 3. read_email
  server.tool(
    'read_email',
    'Read full details of a specific email, including headers (From, To, Cc, Subject, Date), decoded plain text, HTML body, and attachment metadata.',
    {
      account: z.string().describe('Account alias or email address associated with the email.'),
      message_id: z.string().describe('The Gmail message ID to retrieve.'),
    },
    async ({ account, message_id }) => {
      try {
        const email = await readEmail(account, message_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(email, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Read email error: ${err.message}` }],
        };
      }
    }
  );

  // 4. read_thread
  server.tool(
    'read_thread',
    'Read an entire email thread (conversation history), displaying all back-and-forth messages in chronological order.',
    {
      account: z.string().describe('Account alias or email address associated with the thread.'),
      thread_id: z.string().describe('The Gmail thread ID to retrieve.'),
    },
    async ({ account, thread_id }) => {
      try {
        const thread = await readThread(account, thread_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(thread, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Read thread error: ${err.message}` }],
        };
      }
    }
  );

  // 5. download_attachment
  server.tool(
    'download_attachment',
    'Download an email attachment directly to a local directory on your machine.',
    {
      account: z.string().describe('Account alias or email address.'),
      message_id: z.string().describe('The message ID containing the attachment.'),
      attachment_id: z.string().describe('The attachment ID (from read_email metadata).'),
      filename: z.string().describe('Desired filename to save as.'),
      destination_dir: z.string().describe('Absolute local directory path to save the attachment into.'),
    },
    async ({ account, message_id, attachment_id, filename, destination_dir }) => {
      try {
        const result = await downloadAttachment(account, message_id, attachment_id, filename, destination_dir);
        return {
          content: [
            {
              type: 'text',
              text: `✓ Attachment successfully saved to: ${result.savedPath} (${result.size} bytes)`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Download attachment error: ${err.message}` }],
        };
      }
    }
  );

  // 6. create_draft
  server.tool(
    'create_draft',
    'Create an email draft in Gmail. Supported on accounts with "draft" or "full" permission. Safe alternative to sending directly.',
    {
      account: z.string().describe('Account alias or email address to compose from.'),
      to: z.string().describe('Recipient email address(es), comma-separated.'),
      subject: z.string().describe('Email subject line.'),
      body: z.string().describe('Email body content.'),
      cc: z.string().optional().describe('Cc recipients, comma-separated.'),
      bcc: z.string().optional().describe('Bcc recipients, comma-separated.'),
      is_html: z.boolean().default(false).describe('Whether the body contains HTML markup.'),
      thread_id: z.string().optional().describe('Thread ID to attach the draft to (for replies).'),
      in_reply_to_message_id: z.string().optional().describe('Message ID being replied to (sets In-Reply-To header).'),
      attachments: z.array(
        z.object({
          filename: z.string().describe('Attachment filename displayed in email.'),
          file_path: z.string().describe('Absolute path to the local file to attach.'),
        })
      ).optional().describe('List of local file attachments.'),
    },
    async ({ account, to, subject, body, cc, bcc, is_html, thread_id, in_reply_to_message_id, attachments }) => {
      try {
        const acct = resolveAccount(account);
        if (acct.permission === 'readonly') {
          return {
            isError: true,
            content: [{ type: 'text', text: `Account "${acct.alias}" is set to "readonly" permission. Creating drafts is disallowed.` }],
          };
        }

        const draft = await createDraft(account, {
          to,
          subject,
          body,
          cc,
          bcc,
          isHtml: is_html,
          threadId: thread_id,
          inReplyToMessageId: in_reply_to_message_id,
          attachments: attachments?.map((a) => ({ filename: a.filename, filePath: a.file_path })),
        });

        return {
          content: [
            {
              type: 'text',
              text: `✓ Draft created successfully!\nDraft ID: ${draft.draftId}\nAccount: ${draft.account} (${acct.email})\nTo: ${to}\nSubject: ${subject}`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Create draft error: ${err.message}` }],
        };
      }
    }
  );

  // 7. send_email
  server.tool(
    'send_email',
    'Directly send an email or reply to an existing thread. Only permitted on accounts configured with "full" permission.',
    {
      account: z.string().describe('Account alias or email address to send from.'),
      to: z.string().describe('Recipient email address(es), comma-separated.'),
      subject: z.string().describe('Email subject line.'),
      body: z.string().describe('Email body content.'),
      cc: z.string().optional().describe('Cc recipients, comma-separated.'),
      bcc: z.string().optional().describe('Bcc recipients, comma-separated.'),
      is_html: z.boolean().default(false).describe('Whether the body contains HTML markup.'),
      thread_id: z.string().optional().describe('Thread ID to reply to.'),
      in_reply_to_message_id: z.string().optional().describe('Message ID being replied to (sets In-Reply-To header).'),
      attachments: z.array(
        z.object({
          filename: z.string().describe('Attachment filename displayed in email.'),
          file_path: z.string().describe('Absolute path to the local file to attach.'),
        })
      ).optional().describe('List of local file attachments.'),
    },
    async ({ account, to, subject, body, cc, bcc, is_html, thread_id, in_reply_to_message_id, attachments }) => {
      try {
        const acct = resolveAccount(account);
        if (acct.permission !== 'full') {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Security Block: Account "${acct.alias}" is set to "${acct.permission}" permission. Direct email sending is forbidden.\nUse "create_draft" instead, or run "npx gmail-multi-mcp auth set-permission ${acct.alias} full" in your terminal to allow sending.`,
              },
            ],
          };
        }

        const sent = await sendEmail(account, {
          to,
          subject,
          body,
          cc,
          bcc,
          isHtml: is_html,
          threadId: thread_id,
          inReplyToMessageId: in_reply_to_message_id,
          attachments: attachments?.map((a) => ({ filename: a.filename, filePath: a.file_path })),
        });

        return {
          content: [
            {
              type: 'text',
              text: `✓ Email sent successfully!\nMessage ID: ${sent.messageId}\nFrom: ${acct.email} (${acct.alias})\nTo: ${to}\nSubject: ${subject}`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Send email error: ${err.message}` }],
        };
      }
    }
  );

  // 8. modify_email
  server.tool(
    'modify_email',
    'Add or remove labels on an email (e.g. mark as read by removing "UNREAD", archive by removing "INBOX", or star by adding "STARRED"). Disallowed on "readonly" accounts.',
    {
      account: z.string().describe('Account alias or email address.'),
      message_id: z.string().describe('Message ID to modify.'),
      add_labels: z.array(z.string()).optional().describe('List of label IDs to add (e.g. ["STARRED", "IMPORTANT"]).'),
      remove_labels: z.array(z.string()).optional().describe('List of label IDs to remove (e.g. ["UNREAD", "INBOX"]).'),
    },
    async ({ account, message_id, add_labels, remove_labels }) => {
      try {
        const acct = resolveAccount(account);
        if (acct.permission === 'readonly') {
          return {
            isError: true,
            content: [{ type: 'text', text: `Account "${acct.alias}" is set to "readonly" permission. Modifying labels is disallowed.` }],
          };
        }

        const result = await modifyEmail(account, message_id, add_labels, remove_labels);
        return {
          content: [
            {
              type: 'text',
              text: `✓ Modified labels for message ${result.messageId}. Current labels: [${result.labels.join(', ')}]`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Modify email error: ${err.message}` }],
        };
      }
    }
  );

  // 9. trash_email
  server.tool(
    'trash_email',
    'Move an email to the Trash folder (recoverable for 30 days). Permanent deletion is intentionally not exposed for safety. Requires "full" permission.',
    {
      account: z.string().describe('Account alias or email address.'),
      message_id: z.string().describe('Message ID to move to Trash.'),
    },
    async ({ account, message_id }) => {
      try {
        const acct = resolveAccount(account);
        if (acct.permission !== 'full') {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Security Block: Account "${acct.alias}" has "${acct.permission}" permission. Trashing emails requires "full" permission.`,
              },
            ],
          };
        }

        const result = await trashEmail(account, message_id);
        return {
          content: [
            {
              type: 'text',
              text: `✓ Message ${result.messageId} moved to Trash (Account: ${result.account}).`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Trash email error: ${err.message}` }],
        };
      }
    }
  );

  // 10. list_labels
  server.tool(
    'list_labels',
    'List all labels (system and user-defined) in a specific Gmail account.',
    {
      account: z.string().describe('Account alias or email address.'),
    },
    async ({ account }) => {
      try {
        const labels = await listLabels(account);
        return {
          content: [{ type: 'text', text: JSON.stringify(labels, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `List labels error: ${err.message}` }],
        };
      }
    }
  );

  // 11. create_label
  server.tool(
    'create_label',
    'Create a new user label in a specific Gmail account.',
    {
      account: z.string().describe('Account alias or email address.'),
      name: z.string().describe('Name of the new label to create.'),
    },
    async ({ account, name }) => {
      try {
        const result = await createLabel(account, name);
        return {
          content: [
            {
              type: 'text',
              text: `✓ Created label "${result.name}" (ID: ${result.id}) in account "${result.account}".`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Create label error: ${err.message}` }],
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
