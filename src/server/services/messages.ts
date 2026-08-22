import type { core, Principal } from '@kernhq/contracts'
import { channel as rtChannel } from '@kernhq/contracts'
import { KernError, type Kernel, type Tx, uuidv7 } from '@kernhq/kernel'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type {
  Mentions,
  Message,
  MessageKind,
  MessageWithChannel,
  ReactionSummary,
  RichDoc,
  ThreadView,
} from '../../contract/index.js'
import { chatEvents, MODULE_ID } from '../../contract/index.js'
import { docToText, extractMentions, isEmptyDoc, preview, textToDoc } from '../rich.js'
import { bookmarks, channels, messageReactions, messages, pins, threadParticipants } from '../schema.js'
import { type ChannelAccess, ChannelService, objectScope } from './channels.js'
import {
  type ChannelRow,
  hydrateMessages,
  type MessageRow,
  reactionsFor,
  toChannel,
  toMessage,
  withWs,
} from './db.js'
import type { UserDirectory } from './users.js'

export interface PostInput {
  channelId: string
  body: RichDoc
  threadRootId?: string | null
  attachments?: string[]
  broadcast?: boolean
  kind?: MessageKind
  metadata?: Record<string, unknown>
  /** overrides principal.userId (system messages attribute to the acting user) */
  authorId?: string | null
}

interface AffectedMember extends Record<string, unknown> {
  user_id: string
  muted: boolean
  notify_level: string
  unread_count: number
  mention_count: number
}

export const messageUrl = (channelId: string, messageId: string, threadRootId?: string | null) =>
  threadRootId
    ? `/chat/${channelId}/thread/${threadRootId}?m=${messageId}`
    : `/chat/${channelId}?m=${messageId}`

export class MessageService {
  constructor(
    private readonly kernel: Kernel,
    private readonly users: UserDirectory,
    private readonly channels: ChannelService,
  ) {}

  // ------------------------------------------------------------------ reads

  async list(
    workspaceId: string,
    principal: Principal,
    input: {
      channelId: string
      threadRootId?: string
      before?: number
      after?: number
      around?: number
      limit: number
    },
  ): Promise<{ items: Message[]; hasMoreBefore: boolean; hasMoreAfter: boolean }> {
    return withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        await this.channels.requireReadable(tx, principal, workspaceId, input.channelId)
        const scope = input.threadRootId
          ? and(eq(messages.channelId, input.channelId), eq(messages.threadRootId, input.threadRootId))
          : and(
              eq(messages.channelId, input.channelId),
              sql`(${messages.threadRootId} is null or (${messages.metadata}->>'broadcast')::boolean)`,
            )
        const limit = input.limit
        let rows: MessageRow[]
        let hasMoreBefore = false
        let hasMoreAfter = false
        if (input.around != null) {
          const half = Math.max(1, Math.floor(limit / 2))
          const older = await tx
            .select()
            .from(messages)
            .where(and(scope, sql`${messages.seq} <= ${input.around}`))
            .orderBy(desc(messages.seq))
            .limit(half + 1)
          const newer = await tx
            .select()
            .from(messages)
            .where(and(scope, sql`${messages.seq} > ${input.around}`))
            .orderBy(asc(messages.seq))
            .limit(half + 1)
          hasMoreBefore = older.length > half
          hasMoreAfter = newer.length > half
          rows = [...older.slice(0, half).reverse(), ...newer.slice(0, half)]
        } else if (input.after != null) {
          const r = await tx
            .select()
            .from(messages)
            .where(and(scope, sql`${messages.seq} > ${input.after}`))
            .orderBy(asc(messages.seq))
            .limit(limit + 1)
          hasMoreAfter = r.length > limit
          hasMoreBefore = true
          rows = r.slice(0, limit)
        } else {
          const r = await tx
            .select()
            .from(messages)
            .where(and(scope, input.before != null ? sql`${messages.seq} < ${input.before}` : undefined))
            .orderBy(desc(messages.seq))
            .limit(limit + 1)
          hasMoreBefore = r.length > limit
          hasMoreAfter = input.before != null
          rows = r.slice(0, limit).reverse()
        }
        return { items: await hydrateMessages(tx, rows), hasMoreBefore, hasMoreAfter }
      },
      principal.userId,
    )
  }

  async get(workspaceId: string, principal: Principal, messageId: string): Promise<Message> {
    return withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const row = await this.loadMessage(tx, workspaceId, messageId)
        await this.channels.requireReadable(tx, principal, workspaceId, row.channelId)
        return (await hydrateMessages(tx, [row]))[0]!
      },
      principal.userId,
    )
  }

  async thread(
    workspaceId: string,
    principal: Principal,
    messageId: string,
    after: number | undefined,
    limit: number,
  ): Promise<ThreadView> {
    return withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const rootRow = await this.loadMessage(tx, workspaceId, messageId)
        await this.channels.requireReadable(tx, principal, workspaceId, rootRow.channelId)
        const rows = await tx
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.threadRootId, rootRow.id),
              after != null ? sql`${messages.seq} > ${after}` : undefined,
            ),
          )
          .orderBy(asc(messages.seq))
          .limit(limit + 1)
        const participants = (
          await tx
            .select({ u: threadParticipants.userId })
            .from(threadParticipants)
            .where(eq(threadParticipants.threadRootId, rootRow.id))
        ).map((r) => r.u)
        const [root, ...replies] = await hydrateMessages(tx, [rootRow, ...rows.slice(0, limit)])
        return {
          root: root!,
          replies,
          participants: participants as ThreadView['participants'],
          hasMore: rows.length > limit,
        }
      },
      principal.userId,
    )
  }

  async pins(workspaceId: string, principal: Principal, channelId: string): Promise<Message[]> {
    return withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        await this.channels.requireReadable(tx, principal, workspaceId, channelId)
        const rows = await tx
          .select({ m: messages })
          .from(pins)
          .innerJoin(messages, eq(messages.id, pins.messageId))
          .where(eq(pins.channelId, channelId))
          .orderBy(desc(pins.createdAt))
          .limit(200)
        return hydrateMessages(
          tx,
          rows.map((r) => r.m),
        )
      },
      principal.userId,
    )
  }

  async bookmarks(
    workspaceId: string,
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: MessageWithChannel[]; nextCursor: string | null }> {
    return withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const offset = cursor ? Number(cursor) || 0 : 0
        const rows = await tx
          .select({ m: messages, c: channels })
          .from(bookmarks)
          .innerJoin(messages, eq(messages.id, bookmarks.messageId))
          .innerJoin(channels, eq(channels.id, messages.channelId))
          .where(and(eq(bookmarks.workspaceId, workspaceId), eq(bookmarks.userId, userId)))
          .orderBy(desc(bookmarks.createdAt))
          .limit(limit + 1)
          .offset(offset)
        const items = await this.withChannel(tx, rows.slice(0, limit))
        return { items, nextCursor: rows.length > limit ? String(offset + limit) : null }
      },
      userId,
    )
  }

  /** Postgres FTS over `body_text` restricted to channels the caller can read (member or public). */
  async search(
    workspaceId: string,
    principal: Principal,
    input: { q: string; channelId?: string; authorId?: string; limit: number; cursor?: string },
  ) {
    const userId = principal.userId
    return withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const offset = input.cursor ? Number(input.cursor) || 0 : 0
        const readable = sql`(c.type = 'public' or exists (select 1 from mod_chat.channel_members cm where cm.channel_id = c.id and cm.user_id = ${userId}))`
        const res = await tx.execute<{ m: unknown }>(sql`
        select row_to_json(m) as m, row_to_json(c) as c
        from mod_chat.messages m join mod_chat.channels c on c.id = m.channel_id
        where m.workspace_id = ${workspaceId} and m.deleted_at is null
          and m.search @@ websearch_to_tsquery('simple', ${input.q})
          and ${readable}
          ${input.channelId ? sql`and m.channel_id = ${input.channelId}` : sql``}
          ${input.authorId ? sql`and m.author_id = ${input.authorId}` : sql``}
        order by ts_rank(m.search, websearch_to_tsquery('simple', ${input.q})) desc, m.created_at desc
        limit ${input.limit + 1} offset ${offset}`)
        const rows = (res.rows as Array<{ m: Record<string, unknown>; c: Record<string, unknown> }>).map(
          (r) => ({ m: fromJsonRow(r.m), c: fromJsonChannel(r.c) }),
        )
        const items = await this.withChannel(tx, rows.slice(0, input.limit))
        return { items, nextCursor: rows.length > input.limit ? String(offset + input.limit) : null }
      },
      userId,
    )
  }

  private async withChannel(
    tx: Tx,
    rows: Array<{ m: MessageRow; c: ChannelRow }>,
  ): Promise<MessageWithChannel[]> {
    const reactions = await reactionsFor(
      tx,
      rows.map((r) => r.m.id),
    )
    return rows.map((r) => {
      const c = toChannel(r.c)
      return {
        ...toMessage(r.m, reactions.get(r.m.id) ?? []),
        channel: { id: c.id, type: c.type, name: c.name, slug: c.slug },
      }
    })
  }

  // ------------------------------------------------------------------ post

  async post(workspaceId: string, principal: Principal, input: PostInput): Promise<Message> {
    const kind = input.kind ?? 'user'
    const authorId = input.authorId !== undefined ? input.authorId : principal.userId
    if (kind === 'user' && isEmptyDoc(input.body) && !input.attachments?.length)
      throw KernError.badRequest('Message is empty')
    const bodyText = docToText(input.body)
    const mentions =
      kind === 'system' ? { users: [], groups: [], channel: false } : extractMentions(input.body)
    const counts = kind !== 'system'

    const result = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const a =
          kind === 'user' || kind === 'bot'
            ? await this.channels.requireMember(tx, principal, workspaceId, input.channelId)
            : await this.channels.load(tx, workspaceId, input.channelId, authorId)
        if (a.channel.archivedAt) throw KernError.conflict('Channel is archived', 'chat.channel.archived')
        if (
          kind === 'user' &&
          principal.kind !== 'service' &&
          !principal.instanceAdmin &&
          !(await this.kernel.authz.can(principal, 'chat.message.post', objectScope(a.channel)))
        )
          throw KernError.forbidden('chat.message.post')
        let root: MessageRow | null = null
        if (input.threadRootId) {
          root = await this.loadMessage(tx, workspaceId, input.threadRootId)
          if (root.channelId !== input.channelId)
            throw KernError.badRequest('Thread root belongs to another channel')
          if (root.threadRootId) root = await this.loadMessage(tx, workspaceId, root.threadRootId) // replying to a reply → attach to its root
        }
        const now = new Date()
        const [bumped] = await tx
          .update(channels)
          .set({ lastSeq: sql`${channels.lastSeq} + 1`, lastMessageAt: now, updatedAt: now })
          .where(eq(channels.id, input.channelId))
          .returning({ seq: channels.lastSeq })
        const seq = Number(bumped!.seq)
        const id = uuidv7()
        const metadata = {
          ...(input.metadata ?? {}),
          ...(input.broadcast && root ? { broadcast: true } : {}),
        }
        const [row] = await tx
          .insert(messages)
          .values({
            id,
            channelId: input.channelId,
            workspaceId,
            authorId,
            kind,
            threadRootId: root?.id ?? null,
            body: input.body,
            bodyText,
            mentions,
            attachments: input.attachments ?? [],
            seq,
            createdAt: now,
            metadata,
          })
          .returning()
        if (root) {
          await tx
            .update(messages)
            .set({ replyCount: sql`${messages.replyCount} + 1`, lastReplyAt: now })
            .where(eq(messages.id, root.id))
          const ps = [...new Set([authorId, root.authorId].filter((x): x is string => !!x))]
          if (ps.length)
            await tx
              .insert(threadParticipants)
              .values(ps.map((userId) => ({ threadRootId: root!.id, workspaceId, userId, lastReplyAt: now })))
              .onConflictDoUpdate({
                target: [threadParticipants.threadRootId, threadParticipants.userId],
                set: { lastReplyAt: now },
              })
        }
        // unread / mention counters for everyone but the author
        let affected: AffectedMember[] = []
        const mentionCond = sql`(${mentions.channel} or user_id = any(${sql.param(mentions.users)}::uuid[]))`
        if (counts && (!root || input.broadcast)) {
          const r = await tx.execute<AffectedMember>(sql`
          update mod_chat.channel_members set unread_count = unread_count + 1, mention_count = mention_count + (case when ${mentionCond} then 1 else 0 end)
          where channel_id = ${input.channelId} and user_id is distinct from ${authorId}::uuid
          returning user_id, muted, notify_level, unread_count, mention_count`)
          affected = r.rows
        } else if (counts && root && (mentions.channel || mentions.users.length)) {
          const r = await tx.execute<AffectedMember>(sql`
          update mod_chat.channel_members set mention_count = mention_count + 1
          where channel_id = ${input.channelId} and user_id is distinct from ${authorId}::uuid and ${mentionCond}
          returning user_id, muted, notify_level, unread_count, mention_count`)
          affected = r.rows
        }
        const participants = root
          ? (
              await tx
                .select({ u: threadParticipants.userId })
                .from(threadParticipants)
                .where(eq(threadParticipants.threadRootId, root.id))
            ).map((x) => x.u)
          : []
        const memberIds = await this.channels.memberIds(tx, input.channelId)
        const message = toMessage(row!, [])
        // realtime (inside the tx so counters are consistent with what we publish; publishing is fire-and-forget)
        await this.kernel.realtime.toChannel(rtChannel.chat(input.channelId), {
          t: 'change',
          workspaceId,
          change: {
            module: MODULE_ID,
            entity: 'message',
            id,
            op: 'created',
            patch: message as unknown as Record<string, unknown>,
            scope: { channelId: input.channelId, ...(root ? { threadRootId: root.id } : {}) },
          },
        } as never)
        await Promise.all(
          affected.map((m) =>
            this.kernel.realtime.toUser(m.user_id, {
              t: 'change',
              workspaceId,
              change: {
                module: MODULE_ID,
                entity: 'channel',
                id: input.channelId,
                op: 'updated',
                patch: {
                  lastMessageAt: now.toISOString(),
                  lastSeq: seq,
                  unreadCount: m.unread_count,
                  mentionCount: m.mention_count,
                },
              },
            } as never),
          ),
        )
        if (root) {
          const patch = { replyCount: Number(root.replyCount) + 1, lastReplyAt: now.toISOString() }
          await this.kernel.realtime.toChannel(rtChannel.chat(input.channelId), {
            t: 'change',
            workspaceId,
            change: { module: MODULE_ID, entity: 'message', id: root.id, op: 'updated', patch },
          } as never)
          await this.kernel.realtime.toUsers(
            participants.filter((p) => p !== authorId),
            {
              t: 'change',
              workspaceId,
              change: {
                module: MODULE_ID,
                entity: 'thread',
                id: root.id,
                op: 'updated',
                patch: { ...patch, channelId: input.channelId, lastReplyBy: authorId },
              },
            } as never,
          )
        }
        await this.channels.pushBadges(
          workspaceId,
          affected.filter((m) => !m.muted).map((m) => m.user_id),
          tx,
        )
        return { message, a, root, affected, participants, memberIds }
      },
      authorId,
    )

    // post-commit side effects (never fail the post)
    const { message, a, root, affected, participants, memberIds } = result
    await this.kernel
      .emit(
        chatEvents.messagePosted,
        {
          messageId: message.id,
          channelId: message.channelId,
          workspaceId,
          authorId,
          threadRootId: root?.id ?? null,
          mentions: { users: mentions.users, channel: mentions.channel },
          kind,
        } as never,
        { workspaceId, actorId: authorId },
      )
      .catch((err) => this.kernel.log.warn({ err }, 'emit failed'))
    if (kind !== 'system') {
      await Promise.allSettled([
        this.notify(workspaceId, a.channel, message, mentions, affected, participants, root),
        this.index(workspaceId, a.channel, message, memberIds),
        kind === 'user'
          ? this.kernel
              .call('core.activity.record', {
                workspaceId,
                module: MODULE_ID,
                object: { module: MODULE_ID, type: 'channel', id: a.channel.id },
                action: root ? 'thread_replied' : 'message_posted',
                actorId: authorId,
                changes: [],
                data: { messageId: message.id, threadRootId: root?.id ?? null },
              })
              .catch(() => {})
          : Promise.resolve(),
      ]).then((rs) => {
        for (const r of rs)
          if (r.status === 'rejected') this.kernel.log.warn({ err: r.reason }, 'message side effect failed')
      })
    }
    return message
  }

  /** System messages (joined / left / renamed…) – no counters, no notifications. */
  postSystem(input: {
    workspaceId: string
    channelId: string
    actorId: string | null
    event: string
    text: string
    data?: Record<string, unknown>
  }) {
    return this.post(input.workspaceId, this.kernel.system, {
      channelId: input.channelId,
      body: textToDoc(input.text),
      kind: 'system',
      authorId: input.actorId,
      metadata: { event: input.event, ...(input.data ?? {}) },
    })
  }

  /** Bot / automation / webhook messages. */
  postAsBot(input: {
    workspaceId: string
    channelId: string
    text?: string
    body?: RichDoc
    botName: string
    iconUrl?: string | null
    kind?: 'bot' | 'webhook'
    threadRootId?: string | null
    metadata?: Record<string, unknown>
  }) {
    const body = input.body ?? textToDoc(input.text ?? '')
    return this.post(input.workspaceId, this.kernel.system, {
      channelId: input.channelId,
      body,
      kind: input.kind ?? 'bot',
      authorId: null,
      threadRootId: input.threadRootId ?? null,
      metadata: { botName: input.botName, iconUrl: input.iconUrl ?? null, ...(input.metadata ?? {}) },
    })
  }

  // ------------------------------------------------------------------ edit / delete

  async edit(workspaceId: string, principal: Principal, messageId: string, body: RichDoc): Promise<Message> {
    if (isEmptyDoc(body)) throw KernError.badRequest('Message is empty')
    const { message, ch, memberIds } = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const row = await this.loadMessage(tx, workspaceId, messageId)
        const a = await this.channels.requireReadable(tx, principal, workspaceId, row.channelId)
        if (row.deletedAt) throw KernError.conflict('Message was deleted', 'chat.message.deleted')
        if (row.kind === 'system') throw KernError.badRequest('System messages cannot be edited')
        await this.requireOwnerOr(principal, row, a, 'chat.message.edit_any')
        const [upd] = await tx
          .update(messages)
          .set({ body, bodyText: docToText(body), mentions: extractMentions(body), editedAt: new Date() })
          .where(eq(messages.id, messageId))
          .returning()
        return {
          message: (await hydrateMessages(tx, [upd!]))[0]!,
          ch: a.channel,
          memberIds: await this.channels.memberIds(tx, row.channelId),
        }
      },
      principal.userId,
    )
    await this.kernel.realtime.toChannel(rtChannel.chat(message.channelId), {
      t: 'change',
      workspaceId,
      change: {
        module: MODULE_ID,
        entity: 'message',
        id: messageId,
        op: 'updated',
        patch: message as unknown as Record<string, unknown>,
      },
    } as never)
    await this.kernel.emit(
      chatEvents.messageEdited,
      {
        messageId,
        channelId: message.channelId,
        workspaceId,
        authorId: message.authorId,
        threadRootId: message.threadRootId,
      } as never,
      { workspaceId, actorId: principal.userId },
    )
    await this.index(workspaceId, ch, message, memberIds).catch(() => {})
    return message
  }

  async delete(workspaceId: string, principal: Principal, messageId: string): Promise<void> {
    const { row, affectedIds } = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const row = await this.loadMessage(tx, workspaceId, messageId)
        const a = await this.channels.requireReadable(tx, principal, workspaceId, row.channelId)
        if (row.deletedAt) return { row, affectedIds: [] as string[] }
        await this.requireOwnerOr(principal, row, a, 'chat.message.delete_any')
        await tx
          .update(messages)
          .set({
            deletedAt: new Date(),
            body: { type: 'doc', content: [] },
            bodyText: '',
            attachments: [],
            pinned: false,
          })
          .where(eq(messages.id, messageId))
        await tx.delete(pins).where(eq(pins.messageId, messageId))
        if (row.threadRootId)
          await tx
            .update(messages)
            .set({ replyCount: sql`greatest(${messages.replyCount} - 1, 0)` })
            .where(eq(messages.id, row.threadRootId))
        // members who had not read it yet lose one unread (and one mention if they were mentioned)
        const m = (row.mentions as Mentions) ?? { users: [], channel: false }
        const top = !row.threadRootId || (row.metadata as Record<string, unknown>)?.broadcast === true
        const res = await tx.execute<{ user_id: string }>(sql`
        update mod_chat.channel_members set
          unread_count = greatest(unread_count - (case when ${top} then 1 else 0 end), 0),
          mention_count = greatest(mention_count - (case when (${m.channel} or user_id = any(${sql.param(m.users)}::uuid[])) then 1 else 0 end), 0)
        where channel_id = ${row.channelId} and last_read_seq < ${row.seq} and user_id is distinct from ${row.authorId}::uuid and ${row.kind !== 'system'}
        returning user_id`)
        return { row, affectedIds: res.rows.map((r) => r.user_id) }
      },
      principal.userId,
    )
    if (!row.deletedAt) {
      await this.kernel.realtime.toChannel(rtChannel.chat(row.channelId), {
        t: 'change',
        workspaceId,
        change: {
          module: MODULE_ID,
          entity: 'message',
          id: messageId,
          op: 'deleted',
          patch: { threadRootId: row.threadRootId, seq: Number(row.seq) },
        },
      } as never)
      await this.channels.pushBadges(workspaceId, affectedIds)
      await this.kernel.emit(
        chatEvents.messageDeleted,
        {
          messageId,
          channelId: row.channelId,
          workspaceId,
          authorId: row.authorId,
          threadRootId: row.threadRootId,
        } as never,
        { workspaceId, actorId: principal.userId },
      )
      await this.kernel
        .call('core.search.remove', {
          refs: [{ workspaceId, object: { module: MODULE_ID, type: 'message', id: messageId } }],
        })
        .catch(() => {})
    }
  }

  // ------------------------------------------------------------------ reactions / pins / bookmarks

  async react(
    workspaceId: string,
    principal: Principal,
    messageId: string,
    emoji: string,
  ): Promise<{ reactions: ReactionSummary[]; added: boolean }> {
    const userId = principal.userId
    if (!userId) throw KernError.unauthorized()
    const { row, added, reactions } = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const row = await this.loadMessage(tx, workspaceId, messageId)
        await this.channels.requireMember(tx, principal, workspaceId, row.channelId)
        if (row.deletedAt) throw KernError.conflict('Message was deleted', 'chat.message.deleted')
        const del = await tx
          .delete(messageReactions)
          .where(
            and(
              eq(messageReactions.messageId, messageId),
              eq(messageReactions.userId, userId),
              eq(messageReactions.emoji, emoji),
            ),
          )
          .returning()
        const added = del.length === 0
        if (added) await tx.insert(messageReactions).values({ messageId, workspaceId, userId, emoji })
        const reactions = (await reactionsFor(tx, [messageId])).get(messageId) ?? []
        return { row, added, reactions }
      },
      userId,
    )
    await this.kernel.realtime.toChannel(rtChannel.chat(row.channelId), {
      t: 'change',
      workspaceId,
      change: {
        module: MODULE_ID,
        entity: 'message',
        id: messageId,
        op: 'updated',
        patch: { reactions, threadRootId: row.threadRootId },
      },
    } as never)
    await this.kernel.emit(
      added ? chatEvents.reactionAdded : chatEvents.reactionRemoved,
      { messageId, channelId: row.channelId, workspaceId, userId, emoji } as never,
      { workspaceId, actorId: userId },
    )
    return { reactions, added }
  }

  async pin(workspaceId: string, principal: Principal, messageId: string, pinned: boolean): Promise<Message> {
    const message = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const row = await this.loadMessage(tx, workspaceId, messageId)
        const a = await this.channels.requireMember(tx, principal, workspaceId, row.channelId)
        if (
          principal.kind !== 'service' &&
          !principal.instanceAdmin &&
          !(await this.kernel.authz.can(principal, 'chat.message.pin', objectScope(a.channel))) &&
          !(await this.channels.canManage(principal, a))
        )
          throw KernError.forbidden('chat.message.pin')
        if (row.deletedAt) throw KernError.conflict('Message was deleted', 'chat.message.deleted')
        if (pinned)
          await tx
            .insert(pins)
            .values({ messageId, channelId: row.channelId, workspaceId, pinnedBy: principal.userId! })
            .onConflictDoNothing()
        else await tx.delete(pins).where(eq(pins.messageId, messageId))
        const [upd] = await tx.update(messages).set({ pinned }).where(eq(messages.id, messageId)).returning()
        return (await hydrateMessages(tx, [upd!]))[0]!
      },
      principal.userId,
    )
    await this.kernel.realtime.toChannel(rtChannel.chat(message.channelId), {
      t: 'change',
      workspaceId,
      change: { module: MODULE_ID, entity: 'message', id: messageId, op: 'updated', patch: { pinned } },
    } as never)
    return message
  }

  async bookmark(workspaceId: string, principal: Principal, messageId: string, bookmarked: boolean) {
    const userId = principal.userId
    if (!userId) throw KernError.unauthorized()
    await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const row = await this.loadMessage(tx, workspaceId, messageId)
        await this.channels.requireReadable(tx, principal, workspaceId, row.channelId)
        if (bookmarked)
          await tx.insert(bookmarks).values({ userId, messageId, workspaceId }).onConflictDoNothing()
        else
          await tx
            .delete(bookmarks)
            .where(and(eq(bookmarks.userId, userId), eq(bookmarks.messageId, messageId)))
      },
      userId,
    )
  }

  // ------------------------------------------------------------------ side effects

  private async notify(
    workspaceId: string,
    ch: ChannelRow,
    message: Message,
    mentions: Mentions,
    affected: AffectedMember[],
    participants: string[],
    root: MessageRow | null,
  ) {
    if (message.kind === 'system') return
    const actorId = message.authorId
    const actor = actorId
      ? await this.users.get(actorId)
      : { id: null, name: (message.metadata.botName as string) ?? 'Bot' }
    const byUser = new Map(affected.map((m) => [m.user_id, m]))
    const isDm = ch.type === 'dm' || ch.type === 'group_dm'
    const chanLabel = isDm ? 'a direct message' : `#${ch.name ?? 'channel'}`
    const body = preview(message.bodyText) || (message.attachments.length ? 'Sent an attachment' : '')
    const url = messageUrl(ch.id, message.id, message.threadRootId)
    const base = {
      workspaceId: workspaceId as core.CreateNotification['workspaceId'],
      module: MODULE_ID,
      body,
      object: { module: MODULE_ID, type: 'message', id: message.id },
      url,
      data: {
        channelId: ch.id,
        messageId: message.id,
        threadRootId: message.threadRootId,
        channelType: ch.type,
      },
      groupKey: ch.id,
      actorId: actorId as core.CreateNotification['actorId'],
    } as const
    const notified = new Set<string>()
    const send = (userId: string, type: string, title: string) => {
      if (notified.has(userId) || userId === actorId) return Promise.resolve()
      notified.add(userId)
      const n: core.CreateNotification = {
        ...base,
        userId: userId as core.CreateNotification['userId'],
        type,
        title,
        data: { ...base.data },
      }
      return this.kernel
        .call('core.notifications.create', n)
        .catch((err) =>
          this.kernel.log.warn({ err: (err as Error).message, type, userId }, 'notification failed'),
        )
    }
    const level = (userId: string) => byUser.get(userId)?.notify_level ?? 'mentions'
    const muted = (userId: string) => byUser.get(userId)?.muted ?? false
    const jobs: Promise<unknown>[] = []
    // 1. mentions (direct mentions bypass mute; @channel respects it). TODO: expand group mentions via core groups.
    const members = root && !affected.length ? participants : [...byUser.keys()]
    const memberSet = new Set(members)
    for (const u of mentions.users)
      if (memberSet.has(u) && level(u) !== 'none')
        jobs.push(send(u, 'chat.mention', `${actor.name} mentioned you in ${chanLabel}`))
    if (mentions.channel)
      for (const u of members)
        if (!muted(u) && level(u) !== 'none')
          jobs.push(send(u, 'chat.mention', `${actor.name} mentioned @channel in ${chanLabel}`))
    // 2. DMs
    if (isDm)
      for (const u of members)
        if (!muted(u) && level(u) !== 'none')
          jobs.push(send(u, 'chat.dm', ch.type === 'dm' ? actor.name : `${actor.name} in a group message`))
    // 3. thread replies → participants
    if (root)
      for (const u of participants)
        if (!muted(u) && level(u) !== 'none')
          jobs.push(send(u, 'chat.thread_reply', `${actor.name} replied in a thread in ${chanLabel}`))
    // 4. "all messages" channels
    if (!isDm && !root)
      for (const u of members)
        if (!muted(u) && level(u) === 'all')
          jobs.push(send(u, 'chat.channel_message', `${actor.name} in ${chanLabel}`))
    await Promise.all(jobs)
  }

  private async index(workspaceId: string, ch: ChannelRow, message: Message, memberIds: string[]) {
    if (message.kind === 'system' || message.deletedAt) return
    const doc: core.SearchDocument = {
      workspaceId: workspaceId as core.SearchDocument['workspaceId'],
      object: { module: MODULE_ID, type: 'message', id: message.id },
      title: ch.type === 'dm' || ch.type === 'group_dm' ? 'Direct message' : `#${ch.name ?? ''}`,
      body: message.bodyText,
      url: messageUrl(ch.id, message.id, message.threadRootId),
      icon: 'message-square',
      acl: ch.type === 'public' ? null : memberIds,
      updatedAt: message.editedAt ?? message.createdAt,
      attributes: {
        channelId: ch.id,
        channelType: ch.type,
        authorId: message.authorId,
        threadRootId: message.threadRootId,
      },
    }
    await this.kernel
      .call('core.search.index', { documents: [doc] })
      .catch((err) => this.kernel.log.debug({ err: (err as Error).message }, 'search index failed'))
  }

  // ------------------------------------------------------------------ helpers

  async loadMessage(tx: Tx, workspaceId: string, messageId: string): Promise<MessageRow> {
    const [row] = await tx
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.workspaceId, workspaceId)))
      .limit(1)
    if (!row) throw KernError.notFound('Message')
    return row
  }

  private async requireOwnerOr(principal: Principal, row: MessageRow, a: ChannelAccess, permission: string) {
    if (principal.kind === 'service' || principal.instanceAdmin) return
    if (row.authorId && row.authorId === principal.userId) return
    if (await this.kernel.authz.can(principal, permission, objectScope(a.channel))) return
    if (await this.channels.canManage(principal, a)) return
    throw KernError.forbidden(permission)
  }
}

// row_to_json → drizzle-like row (snake_case → camelCase, timestamps → Date)
function fromJsonRow(r: Record<string, unknown>): MessageRow {
  const d = (v: unknown) => (v == null ? null : new Date(v as string))
  return {
    id: r.id as string,
    channelId: r.channel_id as string,
    workspaceId: r.workspace_id as string,
    authorId: (r.author_id as string) ?? null,
    kind: r.kind as string,
    threadRootId: (r.thread_root_id as string) ?? null,
    body: r.body,
    bodyText: (r.body_text as string) ?? '',
    mentions: r.mentions,
    attachments: r.attachments,
    replyCount: Number(r.reply_count ?? 0),
    lastReplyAt: d(r.last_reply_at),
    editedAt: d(r.edited_at),
    deletedAt: d(r.deleted_at),
    pinned: !!r.pinned,
    seq: Number(r.seq),
    createdAt: d(r.created_at)!,
    metadata: r.metadata ?? {},
    search: (r.search as string) ?? '',
  }
}
function fromJsonChannel(r: Record<string, unknown>): ChannelRow {
  const d = (v: unknown) => (v == null ? null : new Date(v as string))
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    type: r.type as string,
    name: (r.name as string) ?? null,
    slug: (r.slug as string) ?? null,
    topic: (r.topic as string) ?? null,
    purpose: (r.purpose as string) ?? null,
    objectModule: (r.object_module as string) ?? null,
    objectType: (r.object_type as string) ?? null,
    objectId: (r.object_id as string) ?? null,
    dmKey: (r.dm_key as string) ?? null,
    autoJoin: !!r.auto_join,
    createdBy: (r.created_by as string) ?? null,
    archivedAt: d(r.archived_at),
    memberCount: Number(r.member_count ?? 0),
    lastMessageAt: d(r.last_message_at),
    lastSeq: Number(r.last_seq ?? 0),
    createdAt: d(r.created_at)!,
    updatedAt: d(r.updated_at)!,
  }
}

export { ChannelService }
