export type AccountPermission = 'readonly' | 'draft' | 'full';

export interface AccountConfig {
  alias: string;
  email: string;
  permission: AccountPermission;
  tokenPath: string;
  oauthKeyPath?: string;
  addedAt: string;
  lastUsedAt?: string;
}

export interface AccountsRegistry {
  version: number;
  defaultOAuthKeyPath: string;
  accounts: Record<string, AccountConfig>;
}

export interface StoredTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string | null;
  expiry_date?: number | null;
}

export interface EmailAttachmentMeta {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface EmailSummary {
  id: string;
  threadId: string;
  account: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  labels: string[];
}

export interface EmailDetail extends EmailSummary {
  cc?: string;
  bcc?: string;
  bodyText?: string;
  bodyHtml?: string;
  attachments: EmailAttachmentMeta[];
}

export interface ThreadMessage {
  id: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  bodyText?: string;
  attachments: EmailAttachmentMeta[];
}

export interface ThreadDetail {
  id: string;
  account: string;
  subject: string;
  messageCount: number;
  messages: ThreadMessage[];
}

export interface AttachmentInput {
  filename: string;
  filePath: string;
  mimeType?: string;
}
