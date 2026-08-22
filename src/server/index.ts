import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type core, Id, ObjectRef, UserId, WorkspaceId } from '@kernalo/contracts'
import { defineModule, defineServerModule, type Kernel } from '@kernalo/kernel'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import {
  chatEvents,
  chatNotificationTypes,
  chatObjectTypes,
  chatPermissions,
  Message,
  MODULE_ID,
} from '../contract/index.js'
import { readPresence } from './presence.js'
import { preview } from './rich.js'
import { chatRouter } from './router.js'
import { channelMembers, channels, messages, schema } from './schema.js'
import { chatServices, withAll } from './services/index.js'
import { messageUrl } from './services/messages.js'

export * from './presence.js'
export { chatServices } from './services/index.js'

const channelLabel = (type: string, name: string | null) =>
  type === 'dm' || type === 'group_dm' ? 'Direct message' : `#${name ?? 'channel'}`

/**
 * The chat module. Hosted by the `chat` service (alongside the realtime WebSocket gateway),
 * but like every Kern module it can be co-hosted anywhere — access goes through `/api/chat` and `kernel.call`.
 */
export const chatModule = defineServerModule({
  definition: defineModule({
    id: MODULE_ID,
    name: 'Chat',
    version: '0.1.0',
    description: 'Channels, direct messages, threads, reactions, mentions, read-state and search',
    icon: 'message-square',
    core: false,
    defaultHost: 'chat',
    permissions: chatPermissions,
    events: chatEvents,
    notificationTypes: chatNotificationTypes,
    objectTypes: chatObjectTypes,
  }),
  schema,
  migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '../../migrations'),
  router: chatRouter,

  subscriptions: {
    /** every new workspace gets #general (auto-join) and #random */
    'core.workspace.created': async (e, kernel) => {
      const p = e.payload as { workspaceId: string; createdBy: string }
      await chatServices(kernel).channels.bootstrapWorkspace(p.workspaceId, p.createdBy)
    },
    /** new members join every auto-join channel */
    'core.member.joined': async (e, kernel) => {
      const p = e.payload as { workspaceId: string; userId: string }
      await chatServices(kernel).channels.joinAutoChannels(p.workspaceId, p.userId)
    },
    /** removed members lose all channel memberships (DMs keep history but drop the membership) */
    'core.member.removed': async (e, kernel) => {
      const p = e.payload as { workspaceId: string; userId: string }
      await chatServices(kernel).channels.removeFromWorkspace(p.workspaceId, p.userId)
    },
  },

  /** procedures other modules/services call via `kernel.call('chat.<name>', …)` */
  procedures: {
    'channels.ensureObjectChannel': {
      input: z.object({
        workspaceId: WorkspaceId,
        objectRef: ObjectRef,
        name: z.string().min(1).max(120),
        memberIds: z.array(UserId).max(500).default([]),
      }),
      handler: (input, { kernel, principal }) =>
        chatServices(kernel).channels.ensureObjectChannel(
          input.workspaceId,
          principal.userId,
          input.objectRef,
          input.name,
          input.memberIds,
        ),
    },
    'channels.addMembers': {
      input: z.object({ workspaceId: WorkspaceId, channelId: Id, userIds: z.array(UserId).min(1).max(500) }),
      output: z.object({ added: z.array(UserId) }),
      handler: async (input, { kernel, principal }) => ({
        added: await chatServices(kernel).channels.addMembers(
          input.workspaceId,
          principal,
          input.channelId,
          input.userIds,
        ),
      }),
    },
    'messages.postSystem': {
      input: z.object({
        workspaceId: WorkspaceId,
        channelId: Id,
        actorId: UserId.nullable().default(null),
        event: z.string().min(1).max(64),
        text: z.string().min(1).max(4000),
        data: z.record(z.string(), z.unknown()).default({}),
      }),
      output: Message,
      handler: (input, { kernel }) => chatServices(kernel).messages.postSystem(input),
    },
    'presence.get': {
      input: z.object({ userIds: z.array(UserId).min(1).max(500) }),
      handler: async (input, { kernel }) => readPresence(kernel, input.userIds),
    },
  },

  /** re-index a single message on demand (core full reindex / repair) */
  search: [
    {
      types: ['message'],
      load: async (workspaceId, id, kernel): Promise<core.SearchDocument | null> => {
        return withAll(kernel, async (tx) => {
          const [m] = await tx
            .select()
            .from(messages)
            .where(and(eq(messages.id, id), eq(messages.workspaceId, workspaceId)))
            .limit(1)
          if (!m || m.deletedAt || m.kind === 'system') return null
          const [ch] = await tx.select().from(channels).where(eq(channels.id, m.channelId)).limit(1)
          if (!ch) return null
          const memberIds =
            ch.type === 'public'
              ? null
              : (
                  await tx
                    .select({ u: channelMembers.userId })
                    .from(channelMembers)
                    .where(eq(channelMembers.channelId, ch.id))
                ).map((r) => r.u)
          return {
            workspaceId: workspaceId as core.SearchDocument['workspaceId'],
            object: { module: MODULE_ID, type: 'message', id: m.id },
            title: channelLabel(ch.type, ch.name),
            body: m.bodyText,
            url: messageUrl(ch.id, m.id, m.threadRootId),
            icon: 'message-square',
            acl: memberIds,
            updatedAt: (m.editedAt ?? m.createdAt).toISOString(),
            attributes: { channelId: ch.id, channelType: ch.type, authorId: m.authorId },
          }
        })
      },
    },
  ],

  /** render `chat:channel:<id>` / `chat:message:<id>` ObjectRefs anywhere in the product */
  resolvers: [
    {
      type: 'channel',
      resolve: async (workspaceId, ids, _principal, kernel) =>
        withAll(kernel, async (tx) => {
          const rows = await tx
            .select()
            .from(channels)
            .where(and(eq(channels.workspaceId, workspaceId), inArray(channels.id, ids)))
          const byId = new Map(rows.map((r) => [r.id, r]))
          return ids.map((id) => {
            const r = byId.get(id)
            if (!r) return null
            return {
              id,
              title: channelLabel(r.type, r.name),
              url: `/chat/${id}`,
              icon: r.type === 'dm' || r.type === 'group_dm' ? 'user' : 'hash',
              subtitle: r.topic,
            }
          })
        }),
    },
    {
      type: 'message',
      resolve: async (workspaceId, ids, _principal, kernel) =>
        withAll(kernel, async (tx) => {
          const rows = await tx
            .select()
            .from(messages)
            .where(and(eq(messages.workspaceId, workspaceId), inArray(messages.id, ids)))
          const byId = new Map(rows.map((r) => [r.id, r]))
          return ids.map((id) => {
            const r = byId.get(id)
            if (!r || r.deletedAt) return null
            return {
              id,
              title: preview(r.bodyText, 80) || 'Message',
              url: messageUrl(r.channelId, r.id, r.threadRootId),
              icon: 'message-square',
              subtitle: null,
            }
          })
        }),
    },
  ],
})

export default chatModule
export type ChatModule = typeof chatModule

// re-export for hosts that want direct access (the chat service gateway)
export type { ChannelAccess } from './services/channels.js'
export type { Kernel }
export { chatRouter }
