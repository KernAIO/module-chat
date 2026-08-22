import { createHash } from 'node:crypto'
import { KernError, type Kernel, type RequestContext, requires, workspaceScoped } from '@kernhq/kernel'
import { implement } from '@orpc/server'
import { and, eq, isNull } from 'drizzle-orm'
import { chatContract, MODULE_ID } from '../contract/index.js'
import { webhooks } from './schema.js'
import { withAll } from './services/db.js'
import { chatServices } from './services/index.js'

const os = implement(chatContract).$context<RequestContext>()
// everything except `webhooks` takes `workspaceId` and runs behind the workspace/module gate
const { webhooks: webhookContract, ...workspaceContract } = chatContract

/** oRPC router for `/api/chat`. Thin: all logic lives in the services. */
export function chatRouter(kernel: Kernel) {
  const svc = chatServices(kernel)
  const scoped = implement(workspaceContract).$context<RequestContext>().use(workspaceScoped(MODULE_ID))
  const uid = (ctx: RequestContext) => {
    if (!ctx.principal.userId) throw KernError.unauthorized()
    return ctx.principal.userId
  }

  return os.router({
    channels: {
      list: scoped.channels.list
        .use(requires('chat.channel.view'))
        .handler(({ input, context }) =>
          svc.channels.listMine(input.workspaceId, uid(context), input.includeArchived),
        ),
      browse: scoped.channels.browse
        .use(requires('chat.channel.view'))
        .handler(({ input, context }) =>
          svc.channels.browse(
            input.workspaceId,
            uid(context),
            input.q,
            input.includeArchived,
            input.limit,
            input.cursor,
          ),
        ),
      get: scoped.channels.get
        .use(requires('chat.channel.view'))
        .handler(({ input, context }) =>
          svc.channels.get(input.workspaceId, context.principal, input.channelId),
        ),
      create: scoped.channels.create
        .use(requires('chat.channel.create'))
        .handler(({ input, context }) => svc.channels.create(input.workspaceId, context.principal, input)),
      update: scoped.channels.update.handler(({ input, context }) =>
        svc.channels.update(input.workspaceId, context.principal, input.channelId, input.patch),
      ),
      archive: scoped.channels.archive.handler(({ input, context }) =>
        svc.channels.archive(input.workspaceId, context.principal, input.channelId, input.archived),
      ),
      join: scoped.channels.join
        .use(requires('chat.channel.view'))
        .handler(({ input, context }) =>
          svc.channels.join(input.workspaceId, context.principal, input.channelId),
        ),
      leave: scoped.channels.leave.handler(async ({ input, context }) => {
        await svc.channels.leave(input.workspaceId, context.principal, input.channelId)
        return { ok: true as const }
      }),
      members: {
        list: scoped.channels.members.list.handler(({ input, context }) =>
          svc.channels.listMembers(
            input.workspaceId,
            context.principal,
            input.channelId,
            input.limit,
            input.cursor,
          ),
        ),
        add: scoped.channels.members.add.handler(async ({ input, context }) => ({
          added: (await svc.channels.addMembers(
            input.workspaceId,
            context.principal,
            input.channelId,
            input.userIds,
          )) as never,
        })),
        remove: scoped.channels.members.remove.handler(async ({ input, context }) => {
          await svc.channels.removeMember(input.workspaceId, context.principal, input.channelId, input.userId)
          return { ok: true as const }
        }),
        setRole: scoped.channels.members.setRole.handler(({ input, context }) =>
          svc.channels.setRole(
            input.workspaceId,
            context.principal,
            input.channelId,
            input.userId,
            input.role,
          ),
        ),
      },
      updateMembership: scoped.channels.updateMembership.handler(({ input, context }) =>
        svc.channels.updateMembership(input.workspaceId, context.principal, input.channelId, {
          muted: input.muted,
          notifyLevel: input.notifyLevel,
        }),
      ),
      openDm: scoped.channels.openDm
        .use(requires('chat.dm.create'))
        .handler(({ input, context }) =>
          svc.channels.openDm(input.workspaceId, context.principal, input.userId),
        ),
      createGroupDm: scoped.channels.createGroupDm
        .use(requires('chat.dm.create'))
        .handler(({ input, context }) =>
          svc.channels.createGroupDm(input.workspaceId, context.principal, input.userIds),
        ),
      ensureObjectChannel: scoped.channels.ensureObjectChannel
        .use(requires('chat.channel.view'))
        .handler(({ input, context }) =>
          svc.channels.ensureObjectChannel(
            input.workspaceId,
            context.principal.userId,
            input.objectRef,
            input.name,
            input.memberIds,
          ),
        ),
      markRead: scoped.channels.markRead.handler(({ input, context }) =>
        svc.channels.markRead(input.workspaceId, context.principal, input.channelId, input.messageId),
      ),
      unread: scoped.channels.unread.handler(({ input, context }) =>
        svc.channels.unread(input.workspaceId, uid(context)),
      ),
      favorite: scoped.channels.favorite.handler(async ({ input, context }) => {
        await svc.channels.setFavorite(input.workspaceId, context.principal, input.channelId, input.favorite)
        return { ok: true as const }
      }),
    },

    sections: {
      create: scoped.sections.create.handler(({ input, context }) =>
        svc.channels.createSection(input.workspaceId, uid(context), input.name),
      ),
      update: scoped.sections.update.handler(({ input, context }) =>
        svc.channels.updateSection(input.workspaceId, uid(context), input.sectionId, {
          name: input.name,
          collapsed: input.collapsed,
        }),
      ),
      delete: scoped.sections.delete.handler(async ({ input, context }) => {
        await svc.channels.deleteSection(input.workspaceId, uid(context), input.sectionId)
        return { ok: true as const }
      }),
      reorder: scoped.sections.reorder.handler(({ input, context }) =>
        svc.channels.reorderSections(input.workspaceId, uid(context), input.sectionIds),
      ),
      setChannel: scoped.sections.setChannel.handler(async ({ input, context }) => {
        await svc.channels.setSectionChannel(
          input.workspaceId,
          uid(context),
          input.channelId,
          input.sectionId,
          input.position,
        )
        return { ok: true as const }
      }),
    },

    messages: {
      list: scoped.messages.list.handler(({ input, context }) =>
        svc.messages.list(input.workspaceId, context.principal, input),
      ),
      get: scoped.messages.get.handler(({ input, context }) =>
        svc.messages.get(input.workspaceId, context.principal, input.messageId),
      ),
      post: scoped.messages.post.handler(({ input, context }) =>
        svc.messages.post(input.workspaceId, context.principal, {
          channelId: input.channelId,
          body: input.body,
          threadRootId: input.threadRootId,
          attachments: input.attachments,
          broadcast: input.broadcast,
        }),
      ),
      edit: scoped.messages.edit.handler(({ input, context }) =>
        svc.messages.edit(input.workspaceId, context.principal, input.messageId, input.body),
      ),
      delete: scoped.messages.delete.handler(async ({ input, context }) => {
        await svc.messages.delete(input.workspaceId, context.principal, input.messageId)
        return { ok: true as const }
      }),
      thread: scoped.messages.thread.handler(({ input, context }) =>
        svc.messages.thread(input.workspaceId, context.principal, input.messageId, input.after, input.limit),
      ),
      react: scoped.messages.react.handler(({ input, context }) =>
        svc.messages.react(input.workspaceId, context.principal, input.messageId, input.emoji),
      ),
      pin: scoped.messages.pin.handler(({ input, context }) =>
        svc.messages.pin(input.workspaceId, context.principal, input.messageId, input.pinned),
      ),
      pins: scoped.messages.pins.handler(({ input, context }) =>
        svc.messages.pins(input.workspaceId, context.principal, input.channelId),
      ),
      bookmark: scoped.messages.bookmark.handler(async ({ input, context }) => {
        await svc.messages.bookmark(input.workspaceId, context.principal, input.messageId, input.bookmarked)
        return { ok: true as const }
      }),
      bookmarks: scoped.messages.bookmarks.handler(({ input, context }) =>
        svc.messages.bookmarks(input.workspaceId, uid(context), input.limit, input.cursor),
      ),
      search: scoped.messages.search.handler(({ input, context }) =>
        svc.messages.search(input.workspaceId, context.principal, input),
      ),
    },

    commands: {
      // TODO: pluggable slash commands (module-registered + workspace custom commands). Built-ins for now.
      run: scoped.commands.run.handler(async ({ input, context }) => {
        const cmd = input.command.replace(/^\//, '').toLowerCase()
        switch (cmd) {
          case 'shrug':
            return {
              handled: true,
              ephemeral: null,
              message: await svc.messages.post(input.workspaceId, context.principal, {
                channelId: input.channelId,
                body: {
                  type: 'doc',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: `${input.text} ¯\\_(ツ)_/¯`.trim() }],
                    },
                  ],
                },
              }),
            }
          case 'me':
            return {
              handled: true,
              ephemeral: null,
              message: await svc.messages.post(input.workspaceId, context.principal, {
                channelId: input.channelId,
                body: {
                  type: 'doc',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: input.text, marks: [{ type: 'italic' }] }],
                    },
                  ],
                },
                metadata: { me: true },
              }),
            }
          case 'leave':
            await svc.channels.leave(input.workspaceId, context.principal, input.channelId)
            return { handled: true, ephemeral: 'You left the channel.', message: null }
          case 'topic': {
            await svc.channels.update(input.workspaceId, context.principal, input.channelId, {
              topic: input.text || null,
            })
            return { handled: true, ephemeral: null, message: null }
          }
          case 'mute':
          case 'unmute':
            await svc.channels.updateMembership(input.workspaceId, context.principal, input.channelId, {
              muted: cmd === 'mute',
            })
            return {
              handled: true,
              ephemeral: cmd === 'mute' ? 'Channel muted.' : 'Channel unmuted.',
              message: null,
            }
          default:
            return { handled: false, ephemeral: `Unknown command /${cmd}`, message: null }
        }
      }),
    },

    webhooks: {
      incoming: os.webhooks.incoming.handler(async ({ input }) => {
        const tokenHash = createHash('sha256').update(input.token).digest('hex')
        const [hook] = await withAll(kernel, (tx) =>
          tx
            .select()
            .from(webhooks)
            .where(and(eq(webhooks.tokenHash, tokenHash), isNull(webhooks.revokedAt)))
            .limit(1),
        )
        if (!hook) throw KernError.notFound('Webhook')
        await svc.messages.postAsBot({
          workspaceId: hook.workspaceId,
          channelId: hook.channelId,
          text: input.text,
          botName: input.username ?? hook.name,
          iconUrl: input.iconUrl ?? null,
          kind: 'webhook',
          metadata: { webhookId: hook.id },
        })
        return { ok: true as const }
      }),
    },
  })
}
