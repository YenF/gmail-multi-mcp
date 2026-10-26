import * as fs from 'fs';
import * as path from 'path';
import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import {
  AccountConfig,
  EmailSummary,
  EmailDetail,
  EmailAttachmentMeta,
  ThreadDetail,
  ThreadMessage,
  AttachmentInput,
  StoredTokens,
} from './types.js';
import { loadOAuthKeys, resolveAccount, listAllAccounts } from './config.js';

export function getOAuth2ClientForAccount(account: AccountConfig): OAuth2Client {
  const creds = loadOAuthKeys(account.oauthKeyPath);
  const oauth2 = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    'http://127.0.0.1'
  );

  if (!fs.existsSync(account.tokenPath)) {
    throw new Error(
      `Token file not found for account "${account.alias}" at: ${account.tokenPath}\n` +
      `Please run "npx gmail-multi-mcp auth add ${account.alias}" to authenticate this account.`
    );
  }

  const tokenData = JSON.parse(fs.readFileSync(account.tokenPath, 'utf-8')) as StoredTokens;
  oauth2.setCredentials(tokenData);

  // Automatically persist refreshed tokens
  oauth2.on('tokens', (newTokens) => {
    const updated = { ...tokenData, ...newTokens };
    fs.writeFileSync(account.tokenPath, JSON.stringify(updated, null, 2), { mode: 0o600 });
  });

  return oauth2;
}

export function getGmailService(account: AccountConfig): gmail_v1.Gmail {
  const auth = getOAuth2ClientForAccount(account);
  return google.gmail({ version: 'v1', auth });
}

function decodeBase64Url(data?: string | null): string {
  if (!data) return '';
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function parseHeaders(headers?: gmail_v1.Schema$MessagePartHeader[]): Record<string, string> {
  const res: Record<string, string> = {};
  if (!headers) return res;
  for (const h of headers) {
    if (h.name && h.value) {
      res[h.name.toLowerCase()] = h.value;
    }
  }
  return res;
}

function extractParts(
  part: gmail_v1.Schema$MessagePart,
  textAcc: string[],
  htmlAcc: string[],
  attachAcc: EmailAttachmentMeta[]
) {
  const mimeType = part.mimeType || '';
  const filename = part.filename || '';

  if (filename && part.body?.attachmentId) {
    attachAcc.push({
      attachmentId: part.body.attachmentId,
      filename,
      mimeType,
      size: part.body.size || 0,
    });
  } else if (mimeType === 'text/plain' && part.body?.data) {
    textAcc.push(decodeBase64Url(part.body.data));
  } else if (mimeType === 'text/html' && part.body?.data) {
    htmlAcc.push(decodeBase64Url(part.body.data));
  }

  if (part.parts && part.parts.length > 0) {
    for (const subPart of part.parts) {
      extractParts(subPart, textAcc, htmlAcc, attachAcc);
    }
  }
}

export async function searchEmails(
  accountTarget: string | string[],
  query: string,
  maxResults: number = 10
): Promise<EmailSummary[]> {
  let targets: AccountConfig[] = [];

  if (accountTarget === 'all' || (Array.isArray(accountTarget) && accountTarget.includes('all'))) {
    targets = listAllAccounts();
  } else if (Array.isArray(accountTarget)) {
    targets = accountTarget.map(resolveAccount);
  } else {
    targets = [resolveAccount(accountTarget)];
  }

  if (targets.length === 0) {
    throw new Error('No accounts available to search. Run "npx gmail-multi-mcp auth add <alias>" first.');
  }

  const searchPromises = targets.map(async (account) => {
    try {
      const gmail = getGmailService(account);
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
      });

      const messageIds = listRes.data.messages || [];
      if (messageIds.length === 0) return [];

      const details = await Promise.all(
        messageIds.map(async (m) => {
          if (!m.id) return null;
          const msg = await gmail.users.messages.get({
            userId: 'me',
            id: m.id,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Subject', 'Date'],
          });
          const headers = parseHeaders(msg.data.payload?.headers);
          return {
            id: msg.data.id || '',
            threadId: msg.data.threadId || '',
            account: account.alias,
            from: headers['from'] || '',
            to: headers['to'] || '',
            subject: headers['subject'] || '(No Subject)',
            date: headers['date'] || '',
            snippet: msg.data.snippet || '',
            labels: msg.data.labelIds || [],
          } as EmailSummary;
        })
      );

      return details.filter((d): d is EmailSummary => d !== null);
    } catch (err) {
      console.error(`[gmail-multi-mcp] Error searching account "${account.alias}":`, err);
      return [];
    }
  });

  const results = await Promise.allSettled(searchPromises);
  const combined: EmailSummary[] = [];

  for (const r of results) {
    if (r.status === 'fulfilled') {
      combined.push(...r.value);
    }
  }

  // Sort newest first by date
  combined.sort((a, b) => {
    const da = Date.parse(a.date) || 0;
    const db = Date.parse(b.date) || 0;
    return db - da;
  });

  return combined.slice(0, maxResults * targets.length);
}

export async function readEmail(accountIdent: string, messageId: string): Promise<EmailDetail> {
  const account = resolveAccount(accountIdent);
  const gmail = getGmailService(account);

  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const headers = parseHeaders(res.data.payload?.headers);
  const textParts: string[] = [];
  const htmlParts: string[] = [];
  const attachments: EmailAttachmentMeta[] = [];

  if (res.data.payload) {
    extractParts(res.data.payload, textParts, htmlParts, attachments);
  }

  return {
    id: res.data.id || messageId,
    threadId: res.data.threadId || '',
    account: account.alias,
    from: headers['from'] || '',
    to: headers['to'] || '',
    cc: headers['cc'],
    bcc: headers['bcc'],
    subject: headers['subject'] || '(No Subject)',
    date: headers['date'] || '',
    snippet: res.data.snippet || '',
    labels: res.data.labelIds || [],
    bodyText: textParts.join('\n\n').trim(),
    bodyHtml: htmlParts.join('\n\n').trim(),
    attachments,
  };
}

export async function readThread(accountIdent: string, threadId: string): Promise<ThreadDetail> {
  const account = resolveAccount(accountIdent);
  const gmail = getGmailService(account);

  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });

  const messages: ThreadMessage[] = [];
  let subject = '(No Subject)';

  for (const msg of res.data.messages || []) {
    const headers = parseHeaders(msg.payload?.headers);
    if (!subject || subject === '(No Subject)') {
      subject = headers['subject'] || subject;
    }

    const textParts: string[] = [];
    const htmlParts: string[] = [];
    const attachments: EmailAttachmentMeta[] = [];

    if (msg.payload) {
      extractParts(msg.payload, textParts, htmlParts, attachments);
    }

    messages.push({
      id: msg.id || '',
      from: headers['from'] || '',
      to: headers['to'] || '',
      date: headers['date'] || '',
      snippet: msg.snippet || '',
      bodyText: textParts.join('\n\n').trim(),
      attachments,
    });
  }

  return {
    id: res.data.id || threadId,
    account: account.alias,
    subject,
    messageCount: messages.length,
    messages,
  };
}

export async function downloadAttachment(
  accountIdent: string,
  messageId: string,
  attachmentId: string,
  filename: string,
  destinationDir: string
): Promise<{ savedPath: string; size: number }> {
  const account = resolveAccount(accountIdent);
  const gmail = getGmailService(account);

  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });

  if (!res.data.data) {
    throw new Error(`Attachment data for ${attachmentId} was empty`);
  }

  const buffer = Buffer.from(res.data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (!fs.existsSync(destinationDir)) {
    fs.mkdirSync(destinationDir, { recursive: true });
  }

  const safeFilename = path.basename(filename);
  const savedPath = path.join(destinationDir, safeFilename);
  fs.writeFileSync(savedPath, buffer);

  return { savedPath, size: buffer.length };
}

function buildMimeMessage(options: {
  from: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  isHtml?: boolean;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: AttachmentInput[];
}): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  const hasAttachments = options.attachments && options.attachments.length > 0;

  const lines: string[] = [];
  lines.push(`From: ${options.from}`);
  lines.push(`To: ${options.to}`);
  if (options.cc) lines.push(`Cc: ${options.cc}`);
  if (options.bcc) lines.push(`Bcc: ${options.bcc}`);
  lines.push(`Subject: =?UTF-8?B?${Buffer.from(options.subject).toString('base64')}?=`);
  if (options.inReplyTo) lines.push(`In-Reply-To: ${options.inReplyTo}`);
  if (options.references) lines.push(`References: ${options.references}`);
  lines.push('MIME-Version: 1.0');

  if (hasAttachments) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push(options.isHtml ? 'Content-Type: text/html; charset=UTF-8' : 'Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(Buffer.from(options.body).toString('base64'));

    for (const att of options.attachments || []) {
      if (!fs.existsSync(att.filePath)) {
        throw new Error(`Attachment file not found: ${att.filePath}`);
      }
      const fileData = fs.readFileSync(att.filePath);
      const mime = att.mimeType || 'application/octet-stream';
      const cleanName = path.basename(att.filename || att.filePath);

      lines.push(`--${boundary}`);
      lines.push(`Content-Type: ${mime}; name="${cleanName}"`);
      lines.push('Content-Transfer-Encoding: base64');
      lines.push(`Content-Disposition: attachment; filename="${cleanName}"`);
      lines.push('');
      lines.push(fileData.toString('base64'));
    }

    lines.push(`--${boundary}--`);
  } else {
    lines.push(options.isHtml ? 'Content-Type: text/html; charset=UTF-8' : 'Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(Buffer.from(options.body).toString('base64'));
  }

  const rawMime = lines.join('\r\n');
  return Buffer.from(rawMime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createDraft(
  accountIdent: string,
  options: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    isHtml?: boolean;
    threadId?: string;
    inReplyToMessageId?: string;
    attachments?: AttachmentInput[];
  }
) {
  const account = resolveAccount(accountIdent);
  const gmail = getGmailService(account);

  const raw = buildMimeMessage({
    from: account.email,
    to: options.to,
    subject: options.subject,
    body: options.body,
    cc: options.cc,
    bcc: options.bcc,
    isHtml: options.isHtml,
    threadId: options.threadId,
    inReplyTo: options.inReplyToMessageId,
    attachments: options.attachments,
  });

  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        raw,
        threadId: options.threadId,
      },
    },
  });

  return {
    draftId: res.data.id || '',
    messageId: res.data.message?.id || '',
    threadId: res.data.message?.threadId || '',
    account: account.alias,
  };
}

export async function sendEmail(
  accountIdent: string,
  options: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    isHtml?: boolean;
    threadId?: string;
    inReplyToMessageId?: string;
    attachments?: AttachmentInput[];
  }
) {
  const account = resolveAccount(accountIdent);
  const gmail = getGmailService(account);

  const raw = buildMimeMessage({
    from: account.email,
    to: options.to,
    subject: options.subject,
    body: options.body,
    cc: options.cc,
    bcc: options.bcc,
    isHtml: options.isHtml,
    threadId: options.threadId,
    inReplyTo: options.inReplyToMessageId,
    attachments: options.attachments,
  });

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw,
      threadId: options.threadId,
    },
  });

  return {
    messageId: res.data.id || '',
    threadId: res.data.threadId || '',
    account: account.alias,
    status: 'sent',
  };
}

export async function createLabel(accountIdent: string, name: string) {
  const account = resolveAccount(accountIdent);
  const gmail = getGmailService(account);

  const res = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });

  return {
    account: account.alias,
    id: res.data.id || '',
    name: res.data.name || name,
  };
}

async function resolveLabelId(gmail: gmail_v1.Gmail, labelNameOrId: string, autoCreate: boolean = false): Promise<string> {
  const listRes = await gmail.users.labels.list({ userId: 'me' });
  const labels = listRes.data.labels || [];

  // Match by exact ID
  const byId = labels.find((l) => l.id === labelNameOrId);
  if (byId && byId.id) return byId.id;

  // Match by case-insensitive name
  const byName = labels.find((l) => l.name && l.name.toLowerCase() === labelNameOrId.toLowerCase());
  if (byName && byName.id) return byName.id;

  if (autoCreate) {
    const createRes = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: labelNameOrId,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });
    return createRes.data.id || labelNameOrId;
  }

  return labelNameOrId;
}

export async function modifyEmail(
  accountIdent: string,
  messageId: string,
  addLabels?: string[],
  removeLabels?: string[]
) {
  const account = resolveAccount(accountIdent);
  const gmail = getGmailService(account);

  const resolvedAdd: string[] = [];
  if (addLabels && addLabels.length > 0) {
    for (const l of addLabels) {
      resolvedAdd.push(await resolveLabelId(gmail, l, true));
    }
  }

  const resolvedRemove: string[] = [];
  if (removeLabels && removeLabels.length > 0) {
    for (const l of removeLabels) {
      resolvedRemove.push(await resolveLabelId(gmail, l, false));
    }
  }

  const res = await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      addLabelIds: resolvedAdd,
      removeLabelIds: resolvedRemove,
    },
  });

  return {
    messageId: res.data.id || messageId,
    labels: res.data.labelIds || [],
    account: account.alias,
  };
}

export async function trashEmail(accountIdent: string, messageId: string) {
  const account = resolveAccount(accountIdent);
  const gmail = getGmailService(account);

  const res = await gmail.users.messages.trash({
    userId: 'me',
    id: messageId,
  });

  return {
    messageId: res.data.id || messageId,
    status: 'trashed',
    account: account.alias,
  };
}

export async function listLabels(accountIdent: string) {
  const account = resolveAccount(accountIdent);
  const gmail = getGmailService(account);

  const res = await gmail.users.labels.list({
    userId: 'me',
  });

  return {
    account: account.alias,
    labels: (res.data.labels || []).map((l) => ({
      id: l.id || '',
      name: l.name || '',
      type: l.type || 'user',
    })),
  };
}
