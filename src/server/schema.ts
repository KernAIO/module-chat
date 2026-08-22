import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// `pgSchema` directly (not `moduleSchema` from @kernhq/kernel) so drizzle-kit can load this file standalone
export const schema = pgSchema('mod_chat')

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })
const ts = (name: string) => timestamp(name, { withTimezone: true })

/**
 * Channels of every kind. `dm_key` = sorted participant ids joined by ':' (dedupes dm / group_dm per workspace);
 * `object_*` identify the ObjectRef of `object` channels (one channel per object per workspace).
 */
export const channels = schema.table(
  'channels',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    type: text('type').notNull(), // public | private | dm | group_dm | object
    name: text('name'),
    slug: text('slug'),
    topic: text('topic'),
    purpose: text('purpose'),
    objectModule: text('object_module'),
    objectType: text('object_type'),
    objectId: uuid('object_id'),
    dmKey: text('dm_key'),
    autoJoin: boolean('auto_join').notNull().default(false),
    createdBy: uuid('created_by'),
    archivedAt: ts('archived_at'),
    memberCount: integer('member_count').notNull().default(0),
    lastMessageAt: ts('last_message_at'),
    /** per-channel message sequence; bumped under row lock when a message is inserted */
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('channels_ws_slug_uq').on(t.workspaceId, t.slug).where(sql`slug is not null`),
    uniqueIndex('channels_ws_dmkey_uq').on(t.workspaceId, t.dmKey).where(sql`dm_key is not null`),
    uniqueIndex('channels_ws_object_uq')
      .on(t.workspaceId, t.objectModule, t.objectType, t.objectId)
      .where(sql`object_id is not null`),
    index('channels_ws_type_idx').on(t.workspaceId, t.type, t.archivedAt),
  ],
)

/** Membership + per-member read state (Mattermost/Zulip style: counters, not per-message receipts). */
export const channelMembers = schema.table(
  'channel_members',
  {
    channelId: uuid('channel_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull().default('member'), // owner | admin | member
    lastReadMessageId: uuid('last_read_message_id'),
    lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
    lastReadAt: ts('last_read_at'),
    unreadCount: integer('unread_count').notNull().default(0),
    mentionCount: integer('mention_count').notNull().default(0),
    muted: boolean('muted').notNull().default(false),
    notifyLevel: text('notify_level').notNull().default('mentions'), // all | mentions | none
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),
    index('channel_members_ws_user_idx').on(t.workspaceId, t.userId),
  ],
)

/** Per-user sidebar sections. */
export const channelSections = schema.table(
  'channel_sections',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    collapsed: boolean('collapsed').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('channel_sections_ws_user_idx').on(t.workspaceId, t.userId, t.position)],
)

export const sectionChannels = schema.table(
  'section_channels',
  {
    sectionId: uuid('section_id').notNull(),
    channelId: uuid('channel_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.sectionId, t.channelId] }),
    uniqueIndex('section_channels_user_channel_uq').on(t.userId, t.channelId),
  ],
)

export const favorites = schema.table(
  'favorites',
  {
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    channelId: uuid('channel_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.channelId] }),
    index('favorites_ws_user_idx').on(t.workspaceId, t.userId),
  ],
)

/**
 * Messages. Partition-ready: no FK to other tables, time-ordered uuidv7 ids, `(workspace_id, created_at)` index;
 * converting to `partition by range (created_at)` only requires adding `created_at` to the PK.
 */
export const messages = schema.table(
  'messages',
  {
    id: uuid('id').primaryKey(),
    channelId: uuid('channel_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    authorId: uuid('author_id'),
    kind: text('kind').notNull().default('user'), // user | system | bot | webhook
    threadRootId: uuid('thread_root_id'),
    body: jsonb('body').notNull(),
    bodyText: text('body_text').notNull().default(''),
    mentions: jsonb('mentions').notNull().default(sql`'{"users":[],"groups":[],"channel":false}'::jsonb`),
    attachments: jsonb('attachments').notNull().default(sql`'[]'::jsonb`),
    replyCount: integer('reply_count').notNull().default(0),
    lastReplyAt: ts('last_reply_at'),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
    pinned: boolean('pinned').notNull().default(false),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    search: tsvector('search').generatedAlwaysAs(sql`to_tsvector('simple', coalesce(body_text, ''))`),
  },
  (t) => [
    uniqueIndex('messages_channel_seq_uq').on(t.channelId, sql`${t.seq} desc`),
    index('messages_thread_idx').on(t.threadRootId, t.seq).where(sql`thread_root_id is not null`),
    index('messages_ws_created_idx').on(t.workspaceId, t.createdAt),
    index('messages_channel_pinned_idx').on(t.channelId).where(sql`pinned`),
    index('messages_search_idx').using('gin', t.search),
  ],
)

export const messageReactions = schema.table(
  'message_reactions',
  {
    messageId: uuid('message_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
)

export const threadParticipants = schema.table(
  'thread_participants',
  {
    threadRootId: uuid('thread_root_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    lastReplyAt: ts('last_reply_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.threadRootId, t.userId] }),
    index('thread_participants_ws_user_idx').on(t.workspaceId, t.userId),
  ],
)

export const pins = schema.table(
  'pins',
  {
    messageId: uuid('message_id').primaryKey(),
    channelId: uuid('channel_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    pinnedBy: uuid('pinned_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('pins_channel_idx').on(t.channelId, t.createdAt)],
)

export const bookmarks = schema.table(
  'bookmarks',
  {
    userId: uuid('user_id').notNull(),
    messageId: uuid('message_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.messageId] }),
    index('bookmarks_ws_user_idx').on(t.workspaceId, t.userId, t.createdAt),
  ],
)

/** Incoming webhook tokens bound to a channel (management UI is a TODO; rows are created via `chat.webhooks.create` procedure). */
export const webhooks = schema.table(
  'webhooks',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    channelId: uuid('channel_id').notNull(),
    /** sha256 of the secret token */
    tokenHash: text('token_hash').notNull(),
    name: text('name').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [uniqueIndex('webhooks_token_uq').on(t.tokenHash)],
)

export const TENANT_TABLES = [
  'channels',
  'channel_members',
  'channel_sections',
  'section_channels',
  'favorites',
  'messages',
  'message_reactions',
  'thread_participants',
  'pins',
  'bookmarks',
  'webhooks',
] as const
