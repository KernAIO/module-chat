import type { core } from '@kernhq/contracts'
import {
  baseContract,
  defineEvent,
  definePermissions,
  Id,
  ObjectRef,
  PageInput,
  page,
  UserId,
  WorkspaceId,
} from '@kernhq/contracts'
import { z } from 'zod'
import {
  Channel,
  ChannelMember,
  ChannelMemberRole,
  ChannelName,
  ChannelSection,
  ChannelView,
  Message,
  MessageWithChannel,
  NotifyLevel,
  ReactionSummary,
  RichDoc,
  ThreadView,
  UnreadSummary,
} from './models.js'

export * from './models.js'

const ws = z.object({ workspaceId: WorkspaceId })
const ch = ws.extend({ channelId: Id })
const msg = ws.extend({ messageId: Id })
const ok = z.object({ ok: z.literal(true) })
const t = (...tags: string[]) => ({ tags })

/** oRPC contract of the chat module, mounted at `/api/chat`. */
export const chatContract = {
  channels: {
    /** channels the caller belongs to (+ DMs), with read state, favorites and sections */
    list: baseContract
      .route({ method: 'GET', path: '/channels', ...t('channels') })
      .input(ws.extend({ includeArchived: z.boolean().default(false) }))
      .output(z.object({ items: z.array(ChannelView), sections: z.array(ChannelSection) })),
    /** public (and archived) channels to browse/join */
    browse: baseContract
      .route({ method: 'GET', path: '/channels/browse', ...t('channels') })
      .input(
        ws
          .extend({ q: z.string().max(100).optional(), includeArchived: z.boolean().default(false) })
          .extend(PageInput.shape),
      )
      .output(page(Channel.extend({ joined: z.boolean() }))),
    get: baseContract
      .route({ method: 'GET', path: '/channels/{channelId}', ...t('channels') })
      .input(ch)
      .output(ChannelView),
    create: baseContract
      .route({ method: 'POST', path: '/channels', ...t('channels') })
      .input(
        ws.extend({
          name: ChannelName,
          type: z.enum(['public', 'private']).default('public'),
          topic: z.string().max(250).optional(),
          purpose: z.string().max(500).optional(),
          memberIds: z.array(UserId).max(500).default([]),
          autoJoin: z.boolean().default(false),
        }),
      )
      .output(ChannelView),
    update: baseContract
      .route({ method: 'PATCH', path: '/channels/{channelId}', ...t('channels') })
      .input(
        ch.extend({
          patch: z.object({
            name: ChannelName.optional(),
            topic: z.string().max(250).nullable().optional(),
            purpose: z.string().max(500).nullable().optional(),
            autoJoin: z.boolean().optional(),
          }),
        }),
      )
      .output(Channel),
    archive: baseContract
      .route({ method: 'POST', path: '/channels/{channelId}/archive', ...t('channels') })
      .input(ch.extend({ archived: z.boolean().default(true) }))
      .output(Channel),
    join: baseContract
      .route({ method: 'POST', path: '/channels/{channelId}/join', ...t('channels') })
      .input(ch)
      .output(ChannelView),
    leave: baseContract
      .route({ method: 'POST', path: '/channels/{channelId}/leave', ...t('channels') })
      .input(ch)
      .output(ok),
    members: {
      list: baseContract
        .route({ method: 'GET', path: '/channels/{channelId}/members', ...t('channels') })
        .input(ch.extend(PageInput.shape))
        .output(page(ChannelMember)),
      add: baseContract
        .route({ method: 'POST', path: '/channels/{channelId}/members', ...t('channels') })
        .input(ch.extend({ userIds: z.array(UserId).min(1).max(500) }))
        .output(z.object({ added: z.array(UserId) })),
      remove: baseContract
        .route({ method: 'DELETE', path: '/channels/{channelId}/members/{userId}', ...t('channels') })
        .input(ch.extend({ userId: UserId }))
        .output(ok),
      setRole: baseContract
        .route({ method: 'PATCH', path: '/channels/{channelId}/members/{userId}', ...t('channels') })
        .input(ch.extend({ userId: UserId, role: ChannelMemberRole }))
        .output(ChannelMember),
    },
    /** the caller's own membership settings (mute / notification level) */
    updateMembership: baseContract
      .route({ method: 'PATCH', path: '/channels/{channelId}/me', ...t('channels') })
      .input(ch.extend({ muted: z.boolean().optional(), notifyLevel: NotifyLevel.optional() }))
      .output(ChannelMember),
    /** open (or find) the 1:1 DM with a user */
    openDm: baseContract
      .route({ method: 'POST', path: '/dm', ...t('dm') })
      .input(ws.extend({ userId: UserId }))
      .output(ChannelView),
    /** create (or find) a group DM with this exact participant set */
    createGroupDm: baseContract
      .route({ method: 'POST', path: '/group-dm', ...t('dm') })
      .input(ws.extend({ userIds: z.array(UserId).min(2).max(24) }))
      .output(ChannelView),
    /** get-or-create the discussion channel of an object (issue, project, candidate, deal…) */
    ensureObjectChannel: baseContract
      .route({ method: 'POST', path: '/object-channel', ...t('channels') })
      .input(
        ws.extend({
          objectRef: ObjectRef,
          name: z.string().min(1).max(120),
          memberIds: z.array(UserId).max(500).default([]),
        }),
      )
      .output(ChannelView),
    markRead: baseContract
      .route({ method: 'POST', path: '/channels/{channelId}/read', ...t('channels') })
      .input(ch.extend({ messageId: Id.optional() }))
      .output(ChannelMember),
    unread: baseContract
      .route({ method: 'GET', path: '/unread', ...t('channels') })
      .input(ws)
      .output(UnreadSummary),
    favorite: baseContract
      .route({ method: 'PUT', path: '/channels/{channelId}/favorite', ...t('channels') })
      .input(ch.extend({ favorite: z.boolean() }))
      .output(ok),
  },

  sections: {
    create: baseContract
      .route({ method: 'POST', path: '/sections', ...t('sections') })
      .input(ws.extend({ name: z.string().min(1).max(60) }))
      .output(ChannelSection),
    update: baseContract
      .route({ method: 'PATCH', path: '/sections/{sectionId}', ...t('sections') })
      .input(
        ws.extend({
          sectionId: Id,
          name: z.string().min(1).max(60).optional(),
          collapsed: z.boolean().optional(),
        }),
      )
      .output(ChannelSection),
    delete: baseContract
      .route({ method: 'DELETE', path: '/sections/{sectionId}', ...t('sections') })
      .input(ws.extend({ sectionId: Id }))
      .output(ok),
    reorder: baseContract
      .route({ method: 'PUT', path: '/sections/order', ...t('sections') })
      .input(ws.extend({ sectionIds: z.array(Id) }))
      .output(z.array(ChannelSection)),
    /** move a channel into a section (null = remove from any section) */
    setChannel: baseContract
      .route({ method: 'PUT', path: '/sections/channel', ...t('sections') })
      .input(ws.extend({ channelId: Id, sectionId: Id.nullable(), position: z.number().int().optional() }))
      .output(ok),
  },

  messages: {
    /**
     * Page through a channel (or a thread when `threadRootId` is given) by `seq`:
     *   - `before`: older than seq (default: latest)   - `after`: newer than seq   - `around`: window centred on seq
     */
    list: baseContract
      .route({ method: 'GET', path: '/channels/{channelId}/messages', ...t('messages') })
      .input(
        ch.extend({
          threadRootId: Id.optional(),
          before: z.number().int().optional(),
          after: z.number().int().optional(),
          around: z.number().int().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        }),
      )
      .output(z.object({ items: z.array(Message), hasMoreBefore: z.boolean(), hasMoreAfter: z.boolean() })),
    get: baseContract
      .route({ method: 'GET', path: '/messages/{messageId}', ...t('messages') })
      .input(msg)
      .output(Message),
    post: baseContract
      .route({ method: 'POST', path: '/channels/{channelId}/messages', ...t('messages') })
      .input(
        ch.extend({
          body: RichDoc,
          threadRootId: Id.optional(),
          attachments: z.array(Id).max(20).default([]),
          /** also post a thread reply to the channel ("also send to channel") */
          broadcast: z.boolean().default(false),
        }),
      )
      .output(Message),
    edit: baseContract
      .route({ method: 'PATCH', path: '/messages/{messageId}', ...t('messages') })
      .input(msg.extend({ body: RichDoc }))
      .output(Message),
    delete: baseContract
      .route({ method: 'DELETE', path: '/messages/{messageId}', ...t('messages') })
      .input(msg)
      .output(ok),
    thread: baseContract
      .route({ method: 'GET', path: '/messages/{messageId}/thread', ...t('messages') })
      .input(
        msg.extend({
          after: z.number().int().optional(),
          limit: z.number().int().min(1).max(200).default(100),
        }),
      )
      .output(ThreadView),
    /** toggle the caller's reaction */
    react: baseContract
      .route({ method: 'POST', path: '/messages/{messageId}/reactions', ...t('messages') })
      .input(msg.extend({ emoji: z.string().min(1).max(32) }))
      .output(z.object({ reactions: z.array(ReactionSummary), added: z.boolean() })),
    pin: baseContract
      .route({ method: 'PUT', path: '/messages/{messageId}/pin', ...t('messages') })
      .input(msg.extend({ pinned: z.boolean() }))
      .output(Message),
    pins: baseContract
      .route({ method: 'GET', path: '/channels/{channelId}/pins', ...t('messages') })
      .input(ch)
      .output(z.array(Message)),
    bookmark: baseContract
      .route({ method: 'PUT', path: '/messages/{messageId}/bookmark', ...t('messages') })
      .input(msg.extend({ bookmarked: z.boolean() }))
      .output(ok),
    bookmarks: baseContract
      .route({ method: 'GET', path: '/bookmarks', ...t('messages') })
      .input(ws.extend(PageInput.shape))
      .output(page(MessageWithChannel)),
    /** full-text search over messages in channels the caller can read */
    search: baseContract
      .route({ method: 'GET', path: '/messages/search', ...t('messages') })
      .input(
        ws
          .extend({ q: z.string().min(1).max(200), channelId: Id.optional(), authorId: UserId.optional() })
          .extend(PageInput.shape),
      )
      .output(page(MessageWithChannel)),
  },

  /** slash commands typed into the composer (`/giphy`, `/remind`…). Built-ins only for now. */
  commands: {
    run: baseContract
      .route({ method: 'POST', path: '/commands', ...t('commands') })
      .input(ch.extend({ command: z.string().min(1).max(32), text: z.string().max(4000).default('') }))
      .output(
        z.object({ handled: z.boolean(), ephemeral: z.string().nullable(), message: Message.nullable() }),
      ),
  },

  /** incoming webhooks: POST /api/chat/webhooks/{token} with `{ text }` posts into the bound channel (TODO: token management UI) */
  webhooks: {
    incoming: baseContract
      .route({ method: 'POST', path: '/webhooks/{token}', ...t('webhooks') })
      .input(
        z.object({
          token: z.string(),
          text: z.string().min(1).max(4000),
          username: z.string().max(80).optional(),
          iconUrl: z.string().url().optional(),
        }),
      )
      .output(ok),
  },
}
export type ChatContract = typeof chatContract

// ---------- events ----------
const MessageEvt = z.object({
  messageId: Id,
  channelId: Id,
  workspaceId: WorkspaceId,
  authorId: UserId.nullable(),
  threadRootId: Id.nullable(),
})
const ChannelEvt = z.object({ channelId: Id, workspaceId: WorkspaceId, type: z.string() })
export const chatEvents = {
  messagePosted: defineEvent(
    'chat.message.posted',
    MessageEvt.extend({
      mentions: z.object({ users: z.array(UserId), channel: z.boolean() }),
      kind: z.string(),
    }),
  ),
  messageEdited: defineEvent('chat.message.edited', MessageEvt),
  messageDeleted: defineEvent('chat.message.deleted', MessageEvt),
  channelCreated: defineEvent(
    'chat.channel.created',
    ChannelEvt.extend({ name: z.string().nullable(), createdBy: UserId.nullable() }),
  ),
  channelUpdated: defineEvent('chat.channel.updated', ChannelEvt.extend({ fields: z.array(z.string()) })),
  channelArchived: defineEvent('chat.channel.archived', ChannelEvt.extend({ archived: z.boolean() })),
  memberAdded: defineEvent(
    'chat.channel.member_added',
    ChannelEvt.extend({ userIds: z.array(UserId), addedBy: UserId.nullable() }),
  ),
  memberRemoved: defineEvent(
    'chat.channel.member_removed',
    ChannelEvt.extend({ userId: UserId, removedBy: UserId.nullable() }),
  ),
  reactionAdded: defineEvent(
    'chat.reaction.added',
    z.object({ messageId: Id, channelId: Id, workspaceId: WorkspaceId, userId: UserId, emoji: z.string() }),
  ),
  reactionRemoved: defineEvent(
    'chat.reaction.removed',
    z.object({ messageId: Id, channelId: Id, workspaceId: WorkspaceId, userId: UserId, emoji: z.string() }),
  ),
} as const

// ---------- permissions ----------
export const chatPermissions = definePermissions([
  {
    key: 'chat.channel.view',
    label: 'View channels',
    scope: 'workspace',
    defaultRoles: ['owner', 'admin', 'member', 'guest'],
    dangerous: false,
  },
  {
    key: 'chat.channel.create',
    label: 'Create channels',
    scope: 'workspace',
    defaultRoles: ['owner', 'admin', 'member'],
    dangerous: false,
  },
  {
    key: 'chat.channel.manage',
    label: 'Manage any channel (rename, topic, members)',
    scope: 'object',
    defaultRoles: ['owner', 'admin'],
    dangerous: false,
  },
  {
    key: 'chat.channel.delete',
    label: 'Archive / delete any channel',
    scope: 'object',
    defaultRoles: ['owner', 'admin'],
    dangerous: true,
  },
  {
    key: 'chat.message.post',
    label: 'Post messages',
    scope: 'object',
    defaultRoles: ['owner', 'admin', 'member', 'guest'],
    dangerous: false,
  },
  {
    key: 'chat.message.edit_any',
    label: "Edit other members' messages",
    scope: 'object',
    defaultRoles: ['owner', 'admin'],
    dangerous: true,
  },
  {
    key: 'chat.message.delete_any',
    label: "Delete other members' messages",
    scope: 'object',
    defaultRoles: ['owner', 'admin'],
    dangerous: true,
  },
  {
    key: 'chat.message.pin',
    label: 'Pin messages',
    scope: 'object',
    defaultRoles: ['owner', 'admin', 'member'],
    dangerous: false,
  },
  {
    key: 'chat.dm.create',
    label: 'Start direct messages',
    scope: 'workspace',
    defaultRoles: ['owner', 'admin', 'member', 'guest'],
    dangerous: false,
  },
])

// ---------- notification types ----------
export const chatNotificationTypes: core.NotificationTypeDef[] = [
  {
    type: 'chat.mention',
    label: 'Mentions in chat',
    description: 'Someone mentioned you or @channel',
    defaults: { inapp: true, push: true, email: false },
    urgent: true,
  },
  {
    type: 'chat.dm',
    label: 'Direct messages',
    defaults: { inapp: true, push: true, email: false },
    urgent: true,
  },
  {
    type: 'chat.thread_reply',
    label: 'Replies in threads you follow',
    defaults: { inapp: true, push: true, email: false },
    urgent: false,
  },
  {
    type: 'chat.channel_message',
    label: 'New messages in channels set to "all messages"',
    defaults: { inapp: true, push: false, email: false },
    urgent: false,
  },
]

/** Object types the chat module owns (for mentions/links/presenters). */
export const chatObjectTypes = [
  { type: 'channel', label: 'Channel', icon: 'hash', channelable: false },
  { type: 'message', label: 'Message', icon: 'message-square', channelable: false },
]
