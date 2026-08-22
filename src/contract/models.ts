import { Id, ObjectRef, Timestamp, UserId, WorkspaceId } from '@kernalo/contracts'
import { z } from 'zod'

export const MODULE_ID = 'chat'

// ---------- channels ----------
export const ChannelType = z.enum(['public', 'private', 'dm', 'group_dm', 'object'])
export type ChannelType = z.infer<typeof ChannelType>
export const ChannelMemberRole = z.enum(['owner', 'admin', 'member'])
export type ChannelMemberRole = z.infer<typeof ChannelMemberRole>
export const NotifyLevel = z.enum(['all', 'mentions', 'none'])
export type NotifyLevel = z.infer<typeof NotifyLevel>

export const ChannelName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\s#@][^#@]*$/, 'channel names cannot start with # or @')

export const Channel = z.object({
  id: Id,
  workspaceId: WorkspaceId,
  type: ChannelType,
  /** display name; for DMs this is derived client-side from the participants (stored null) */
  name: z.string().nullable(),
  slug: z.string().nullable(),
  topic: z.string().nullable(),
  purpose: z.string().nullable(),
  /** for `object` channels: the issue/project/candidate/deal this channel discusses */
  objectRef: ObjectRef.nullable(),
  /** new workspace members are auto-joined (public channels only) */
  autoJoin: z.boolean(),
  createdBy: UserId.nullable(),
  archivedAt: Timestamp.nullable(),
  memberCount: z.number().int().nonnegative(),
  lastMessageAt: Timestamp.nullable(),
  /** seq of the latest message (0 = empty channel) */
  lastSeq: z.number().int().nonnegative(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Channel = z.infer<typeof Channel>

export const ChannelMember = z.object({
  channelId: Id,
  userId: UserId,
  role: ChannelMemberRole,
  lastReadMessageId: Id.nullable(),
  lastReadSeq: z.number().int().nonnegative(),
  lastReadAt: Timestamp.nullable(),
  unreadCount: z.number().int().nonnegative(),
  mentionCount: z.number().int().nonnegative(),
  muted: z.boolean(),
  notifyLevel: NotifyLevel,
  joinedAt: Timestamp,
})
export type ChannelMember = z.infer<typeof ChannelMember>

/** A channel as the caller sees it in the sidebar: with their membership/read state and personal organisation. */
export const ChannelView = Channel.extend({
  membership: ChannelMember.nullable(),
  favorite: z.boolean(),
  sectionId: Id.nullable(),
  /** participants of dm / group_dm channels (excluding nobody – includes the caller) */
  dmUserIds: z.array(UserId),
})
export type ChannelView = z.infer<typeof ChannelView>

export const ChannelSection = z.object({
  id: Id,
  workspaceId: WorkspaceId,
  userId: UserId,
  name: z.string().min(1).max(60),
  position: z.number().int(),
  collapsed: z.boolean(),
  channelIds: z.array(Id),
})
export type ChannelSection = z.infer<typeof ChannelSection>

// ---------- messages ----------
/** Tiptap / ProseMirror JSON document (`{ type: 'doc', content: [...] }`). */
export const RichDoc = z
  .object({ type: z.literal('doc'), content: z.array(z.record(z.string(), z.unknown())).optional() })
  .catchall(z.unknown())
export type RichDoc = z.infer<typeof RichDoc>

export const Mentions = z.object({
  users: z.array(UserId),
  /** group handles / ids */
  groups: z.array(z.string()),
  /** @channel / @here */
  channel: z.boolean(),
})
export type Mentions = z.infer<typeof Mentions>

export const ReactionSummary = z.object({
  emoji: z.string(),
  count: z.number().int(),
  userIds: z.array(UserId),
})
export type ReactionSummary = z.infer<typeof ReactionSummary>

export const MessageKind = z.enum(['user', 'system', 'bot', 'webhook'])
export type MessageKind = z.infer<typeof MessageKind>

export const Message = z.object({
  id: Id,
  channelId: Id,
  workspaceId: WorkspaceId,
  /** null for system/webhook messages */
  authorId: UserId.nullable(),
  kind: MessageKind,
  threadRootId: Id.nullable(),
  body: RichDoc,
  /** plain-text rendering for search, notifications and previews */
  bodyText: z.string(),
  mentions: Mentions,
  /** core file ids */
  attachments: z.array(Id),
  reactions: z.array(ReactionSummary),
  replyCount: z.number().int().nonnegative(),
  lastReplyAt: Timestamp.nullable(),
  editedAt: Timestamp.nullable(),
  deletedAt: Timestamp.nullable(),
  pinned: z.boolean(),
  /** per-channel monotonically increasing sequence number */
  seq: z.number().int().nonnegative(),
  createdAt: Timestamp,
  /** system messages: { event: 'joined'|'left'|'renamed'|..., ...}; bots/webhooks: { botName, iconUrl, ... } */
  metadata: z.record(z.string(), z.unknown()),
})
export type Message = z.infer<typeof Message>

export const MessageWithChannel = Message.extend({
  channel: Channel.pick({ id: true, type: true, name: true, slug: true }),
})
export type MessageWithChannel = z.infer<typeof MessageWithChannel>

export const ThreadView = z.object({
  root: Message,
  replies: z.array(Message),
  participants: z.array(UserId),
  hasMore: z.boolean(),
})
export type ThreadView = z.infer<typeof ThreadView>

export const UnreadSummary = z.object({
  channels: z.array(
    z.object({
      channelId: Id,
      unreadCount: z.number().int(),
      mentionCount: z.number().int(),
      muted: z.boolean(),
    }),
  ),
  totals: z.object({ unread: z.number().int(), mentions: z.number().int() }),
})
export type UnreadSummary = z.infer<typeof UnreadSummary>

/** Realtime payloads published by the chat module (documented here so clients can type them). */
export const ChannelActivityPatch = z.object({
  lastMessageAt: Timestamp,
  lastSeq: z.number().int(),
  unreadCount: z.number().int(),
  mentionCount: z.number().int(),
})
export type ChannelActivityPatch = z.infer<typeof ChannelActivityPatch>
