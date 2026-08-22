import type { ObjectRef, Principal } from '@kernalo/contracts'
import { channel as rtChannel } from '@kernalo/contracts'
import { KernError, type Kernel, type Tx, uuidv7 } from '@kernalo/kernel'
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm'
import type {
  Channel,
  ChannelMember,
  ChannelSection,
  ChannelView,
  NotifyLevel,
  UnreadSummary,
} from '../../contract/index.js'
import { chatEvents, MODULE_ID } from '../../contract/index.js'
import { channelMembers, channelSections, channels, favorites, sectionChannels } from '../schema.js'
import {
  type ChannelRow,
  dmKey,
  type MemberRow,
  slugify,
  toChannel,
  toMember,
  toSection,
  withAll,
  withWs,
} from './db.js'
import type { MessageService } from './messages.js'
import type { UserDirectory } from './users.js'

export interface ChannelAccess {
  channel: ChannelRow
  member: MemberRow | null
  /** member, or public channel (workspace membership must be checked by the caller) */
  canRead: boolean
}

const MANAGER_ROLES = new Set(['owner', 'admin'])

export class ChannelService {
  /** late-bound to avoid a constructor cycle */
  messages!: MessageService
  constructor(
    private readonly kernel: Kernel,
    private readonly users: UserDirectory,
  ) {}

  // ------------------------------------------------------------------ access

  /** Cross-workspace lookup used by the realtime gateway (`sub chat:<id>`) and by object resolvers. */
  async access(userId: string, channelId: string): Promise<ChannelAccess | null> {
    return withAll(this.kernel, async (tx) => {
      const [ch] = await tx.select().from(channels).where(eq(channels.id, channelId)).limit(1)
      if (!ch) return null
      const [m] = await tx
        .select()
        .from(channelMembers)
        .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
        .limit(1)
      return { channel: ch, member: m ?? null, canRead: !!m || ch.type === 'public' }
    })
  }

  async load(tx: Tx, workspaceId: string, channelId: string, userId: string | null): Promise<ChannelAccess> {
    const [ch] = await tx
      .select()
      .from(channels)
      .where(and(eq(channels.id, channelId), eq(channels.workspaceId, workspaceId)))
      .limit(1)
    if (!ch) throw KernError.notFound('Channel')
    const m = userId
      ? (
          await tx
            .select()
            .from(channelMembers)
            .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
            .limit(1)
        )[0]
      : undefined
    return { channel: ch, member: m ?? null, canRead: !!m || ch.type === 'public' }
  }

  /** Readable = member, or public channel in the workspace. Service principals may read everything. */
  async requireReadable(
    tx: Tx,
    principal: Principal,
    workspaceId: string,
    channelId: string,
  ): Promise<ChannelAccess> {
    const a = await this.load(tx, workspaceId, channelId, principal.userId)
    if (principal.kind === 'service' || principal.instanceAdmin) return a
    if (!a.canRead) throw KernError.notFound('Channel')
    return a
  }

  async requireMember(
    tx: Tx,
    principal: Principal,
    workspaceId: string,
    channelId: string,
  ): Promise<ChannelAccess & { member: MemberRow }> {
    const a = await this.load(tx, workspaceId, channelId, principal.userId)
    if (!a.member) {
      if (principal.kind === 'service') return { ...a, member: syntheticMember(a.channel, principal) }
      throw a.canRead ? KernError.forbidden('chat.channel.member') : KernError.notFound('Channel')
    }
    return a as ChannelAccess & { member: MemberRow }
  }

  async canManage(principal: Principal, a: ChannelAccess): Promise<boolean> {
    if (principal.kind === 'service' || principal.instanceAdmin) return true
    if (a.member && MANAGER_ROLES.has(a.member.role)) return true
    return this.kernel.authz.can(principal, 'chat.channel.manage', objectScope(a.channel))
  }
  async requireManage(principal: Principal, a: ChannelAccess) {
    if (!(await this.canManage(principal, a))) throw KernError.forbidden('chat.channel.manage')
  }

  // ------------------------------------------------------------------ reads

  async listMine(
    workspaceId: string,
    userId: string,
    includeArchived = false,
  ): Promise<{ items: ChannelView[]; sections: ChannelSection[] }> {
    return withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const rows = await tx
          .select({ ch: channels, m: channelMembers })
          .from(channelMembers)
          .innerJoin(channels, eq(channels.id, channelMembers.channelId))
          .where(
            and(
              eq(channelMembers.workspaceId, workspaceId),
              eq(channelMembers.userId, userId),
              includeArchived ? undefined : isNull(channels.archivedAt),
            ),
          )
          .orderBy(asc(channels.type), asc(channels.name))
        const favs = new Set(
          (
            await tx
              .select({ id: favorites.channelId })
              .from(favorites)
              .where(and(eq(favorites.workspaceId, workspaceId), eq(favorites.userId, userId)))
          ).map((r) => r.id),
        )
        const secRows = await tx
          .select()
          .from(channelSections)
          .where(and(eq(channelSections.workspaceId, workspaceId), eq(channelSections.userId, userId)))
          .orderBy(asc(channelSections.position), asc(channelSections.createdAt))
        const secCh = await tx
          .select()
          .from(sectionChannels)
          .where(and(eq(sectionChannels.workspaceId, workspaceId), eq(sectionChannels.userId, userId)))
          .orderBy(asc(sectionChannels.position))
        const sectionOf = new Map(secCh.map((r) => [r.channelId, r.sectionId]))
        const dmIds = rows.filter((r) => r.ch.type === 'dm' || r.ch.type === 'group_dm').map((r) => r.ch.id)
        const participants = await this.participants(tx, dmIds)
        const items = rows.map((r) => ({
          ...toChannel(r.ch),
          membership: toMember(r.m),
          favorite: favs.has(r.ch.id),
          sectionId: sectionOf.get(r.ch.id) ?? null,
          dmUserIds: (participants.get(r.ch.id) ?? []) as ChannelView['dmUserIds'],
        }))
        const sections = secRows.map((s) =>
          toSection(
            s,
            secCh.filter((c) => c.sectionId === s.id).map((c) => c.channelId),
          ),
        )
        return { items, sections }
      },
      userId,
    )
  }

  async browse(
    workspaceId: string,
    userId: string,
    q: string | undefined,
    includeArchived: boolean,
    limit: number,
    cursor: string | undefined,
  ) {
    return withWs(this.kernel, workspaceId, async (tx) => {
      const offset = cursor ? Number(cursor) || 0 : 0
      const rows = await tx
        .select({
          ch: channels,
          joined: sql<boolean>`exists (select 1 from mod_chat.channel_members cm where cm.channel_id = ${channels.id} and cm.user_id = ${userId})`,
        })
        .from(channels)
        .where(
          and(
            eq(channels.workspaceId, workspaceId),
            eq(channels.type, 'public'),
            includeArchived ? undefined : isNull(channels.archivedAt),
            q ? ilike(channels.name, `%${q.replace(/[%_]/g, '')}%`) : undefined,
          ),
        )
        .orderBy(desc(channels.memberCount), asc(channels.name))
        .limit(limit + 1)
        .offset(offset)
      const more = rows.length > limit
      return {
        items: rows.slice(0, limit).map((r) => ({ ...toChannel(r.ch), joined: !!r.joined })),
        nextCursor: more ? String(offset + limit) : null,
      }
    })
  }

  async get(workspaceId: string, principal: Principal, channelId: string): Promise<ChannelView> {
    return withWs(this.kernel, workspaceId, async (tx) => {
      const a = await this.requireReadable(tx, principal, workspaceId, channelId)
      return this.view(tx, a, principal.userId)
    })
  }

  async view(tx: Tx, a: ChannelAccess, userId: string | null): Promise<ChannelView> {
    const ch = toChannel(a.channel)
    const isDm = ch.type === 'dm' || ch.type === 'group_dm'
    const participants = isDm ? ((await this.participants(tx, [ch.id])).get(ch.id) ?? []) : []
    let favorite = false
    let sectionId: string | null = null
    if (userId) {
      favorite =
        (
          await tx
            .select({ c: favorites.channelId })
            .from(favorites)
            .where(and(eq(favorites.userId, userId), eq(favorites.channelId, ch.id)))
        ).length > 0
      sectionId =
        (
          await tx
            .select({ s: sectionChannels.sectionId })
            .from(sectionChannels)
            .where(and(eq(sectionChannels.userId, userId), eq(sectionChannels.channelId, ch.id)))
        )[0]?.s ?? null
    }
    return {
      ...ch,
      membership: a.member ? toMember(a.member) : null,
      favorite,
      sectionId,
      dmUserIds: participants as ChannelView['dmUserIds'],
    }
  }

  private async participants(tx: Tx, channelIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>()
    if (!channelIds.length) return map
    const rows = await tx
      .select({ channelId: channelMembers.channelId, userId: channelMembers.userId })
      .from(channelMembers)
      .where(inArray(channelMembers.channelId, channelIds))
    for (const r of rows) map.set(r.channelId, [...(map.get(r.channelId) ?? []), r.userId])
    return map
  }

  async memberIds(tx: Tx, channelId: string): Promise<string[]> {
    return (
      await tx
        .select({ userId: channelMembers.userId })
        .from(channelMembers)
        .where(eq(channelMembers.channelId, channelId))
    ).map((r) => r.userId)
  }

  async listMembers(
    workspaceId: string,
    principal: Principal,
    channelId: string,
    limit: number,
    cursor?: string,
  ) {
    return withWs(this.kernel, workspaceId, async (tx) => {
      await this.requireReadable(tx, principal, workspaceId, channelId)
      const offset = cursor ? Number(cursor) || 0 : 0
      const rows = await tx
        .select()
        .from(channelMembers)
        .where(eq(channelMembers.channelId, channelId))
        .orderBy(asc(channelMembers.joinedAt))
        .limit(limit + 1)
        .offset(offset)
      return {
        items: rows.slice(0, limit).map(toMember),
        nextCursor: rows.length > limit ? String(offset + limit) : null,
      }
    })
  }

  // ------------------------------------------------------------------ writes

  async create(
    workspaceId: string,
    principal: Principal,
    input: {
      name: string
      type: 'public' | 'private'
      topic?: string
      purpose?: string
      memberIds?: string[]
      autoJoin?: boolean
    },
  ): Promise<ChannelView> {
    const actorId = principal.userId
    const view = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const slug = await this.uniqueSlug(tx, workspaceId, slugify(input.name))
        const id = uuidv7()
        const [row] = await tx
          .insert(channels)
          .values({
            id,
            workspaceId,
            type: input.type,
            name: input.name.trim(),
            slug,
            topic: input.topic ?? null,
            purpose: input.purpose ?? null,
            autoJoin: input.type === 'public' && !!input.autoJoin,
            createdBy: actorId,
          })
          .returning()
        const members = [...new Set([...(actorId ? [actorId] : []), ...(input.memberIds ?? [])])]
        await this.insertMembers(tx, row!, members, actorId, { ownerId: actorId })
        const a = await this.load(tx, workspaceId, id, actorId)
        return this.view(tx, a, actorId)
      },
      actorId,
    )
    await this.kernel.emit(
      chatEvents.channelCreated,
      { channelId: view.id, workspaceId, type: view.type, name: view.name, createdBy: actorId } as never,
      { workspaceId, actorId },
    )
    await this.announceChannel(view, 'created')
    await this.messages
      .postSystem({ workspaceId, channelId: view.id, actorId, event: 'created', text: `created the channel` })
      .catch(() => {})
    return view
  }

  async update(
    workspaceId: string,
    principal: Principal,
    channelId: string,
    patch: { name?: string; topic?: string | null; purpose?: string | null; autoJoin?: boolean },
  ): Promise<Channel> {
    const { row, a } = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const a = await this.requireReadable(tx, principal, workspaceId, channelId)
        await this.requireManage(principal, a)
        if (a.channel.type === 'dm') throw KernError.badRequest('Direct messages cannot be edited')
        const set: Partial<typeof channels.$inferInsert> = { updatedAt: new Date() }
        if (patch.name !== undefined && patch.name !== a.channel.name) {
          set.name = patch.name.trim()
          if (a.channel.slug)
            set.slug = await this.uniqueSlug(tx, workspaceId, slugify(patch.name), channelId)
        }
        if (patch.topic !== undefined) set.topic = patch.topic
        if (patch.purpose !== undefined) set.purpose = patch.purpose
        if (patch.autoJoin !== undefined && a.channel.type === 'public') set.autoJoin = patch.autoJoin
        const [row] = await tx.update(channels).set(set).where(eq(channels.id, channelId)).returning()
        return { row: row!, a }
      },
      principal.userId,
    )
    const fields = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined)
    await this.kernel.emit(
      chatEvents.channelUpdated,
      { channelId, workspaceId, type: row.type, fields } as never,
      { workspaceId, actorId: principal.userId },
    )
    const ch = toChannel(row)
    await this.kernel.realtime.toChannel(rtChannel.chat(channelId), {
      t: 'change',
      workspaceId,
      change: { module: MODULE_ID, entity: 'channel', id: channelId, op: 'updated', patch: ch },
    } as never)
    if (patch.name && patch.name !== a.channel.name)
      await this.messages
        .postSystem({
          workspaceId,
          channelId,
          actorId: principal.userId,
          event: 'renamed',
          text: `renamed the channel to ${patch.name}`,
          data: { from: a.channel.name, to: patch.name },
        })
        .catch(() => {})
    else if (patch.topic !== undefined)
      await this.messages
        .postSystem({
          workspaceId,
          channelId,
          actorId: principal.userId,
          event: 'topic',
          text: patch.topic ? `set the topic: ${patch.topic}` : 'cleared the topic',
        })
        .catch(() => {})
    return ch
  }

  async archive(
    workspaceId: string,
    principal: Principal,
    channelId: string,
    archived: boolean,
  ): Promise<Channel> {
    const row = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const a = await this.requireReadable(tx, principal, workspaceId, channelId)
        const allowed =
          principal.kind === 'service' ||
          principal.instanceAdmin ||
          a.member?.role === 'owner' ||
          (await this.kernel.authz.can(principal, 'chat.channel.delete', objectScope(a.channel)))
        if (!allowed) throw KernError.forbidden('chat.channel.delete')
        if (a.channel.type === 'dm' || a.channel.type === 'group_dm')
          throw KernError.badRequest('Direct messages cannot be archived')
        const [row] = await tx
          .update(channels)
          .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
          .where(eq(channels.id, channelId))
          .returning()
        return row!
      },
      principal.userId,
    )
    await this.kernel.emit(
      chatEvents.channelArchived,
      { channelId, workspaceId, type: row.type, archived } as never,
      { workspaceId, actorId: principal.userId },
    )
    const ch = toChannel(row)
    await this.kernel.realtime.toChannel(rtChannel.chat(channelId), {
      t: 'change',
      workspaceId,
      change: { module: MODULE_ID, entity: 'channel', id: channelId, op: 'updated', patch: ch },
    } as never)
    await this.kernel.realtime.change(workspaceId, {
      module: MODULE_ID,
      entity: 'channel',
      id: channelId,
      op: 'updated',
      patch: { archivedAt: ch.archivedAt },
    })
    return ch
  }

  async join(workspaceId: string, principal: Principal, channelId: string): Promise<ChannelView> {
    const userId = principal.userId
    if (!userId) throw KernError.unauthorized()
    const { view, added } = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const a = await this.load(tx, workspaceId, channelId, userId)
        if (a.channel.type !== 'public') throw KernError.notFound('Channel')
        if (a.channel.archivedAt) throw KernError.conflict('Channel is archived', 'chat.channel.archived')
        const added = a.member ? [] : await this.insertMembers(tx, a.channel, [userId], userId, {})
        return {
          view: await this.view(tx, await this.load(tx, workspaceId, channelId, userId), userId),
          added,
        }
      },
      userId,
    )
    if (added.length) await this.afterMembersAdded(workspaceId, channelId, view.type, added, userId, 'joined')
    return view
  }

  async leave(workspaceId: string, principal: Principal, channelId: string): Promise<void> {
    const userId = principal.userId
    if (!userId) throw KernError.unauthorized()
    await this.removeMember(workspaceId, principal, channelId, userId)
  }

  async addMembers(
    workspaceId: string,
    principal: Principal,
    channelId: string,
    userIds: string[],
  ): Promise<string[]> {
    const { added, type } = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const a = await this.requireReadable(tx, principal, workspaceId, channelId)
        if (a.channel.type === 'dm') throw KernError.badRequest('Cannot add members to a direct message')
        if (a.channel.archivedAt) throw KernError.conflict('Channel is archived', 'chat.channel.archived')
        // any member may invite to public channels; private/object/group channels need a manager (or service)
        if (a.channel.type !== 'public' && !(await this.canManage(principal, a)))
          throw KernError.forbidden('chat.channel.manage')
        if (
          a.channel.type === 'public' &&
          !a.member &&
          principal.kind !== 'service' &&
          !principal.instanceAdmin
        )
          throw KernError.forbidden('chat.channel.member')
        return {
          added: await this.insertMembers(tx, a.channel, userIds, principal.userId, {}),
          type: a.channel.type,
        }
      },
      principal.userId,
    )
    if (added.length)
      await this.afterMembersAdded(workspaceId, channelId, type, added, principal.userId, 'added')
    return added
  }

  async removeMember(
    workspaceId: string,
    principal: Principal,
    channelId: string,
    userId: string,
  ): Promise<void> {
    const self = principal.userId === userId
    const { removed, type } = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const a = await this.load(tx, workspaceId, channelId, userId)
        if (!a.member) return { removed: false, type: a.channel.type }
        if (a.channel.type === 'dm') throw KernError.badRequest('Cannot leave a direct message')
        if (!self)
          await this.requireManage(principal, await this.load(tx, workspaceId, channelId, principal.userId))
        await tx
          .delete(channelMembers)
          .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
        await tx
          .delete(sectionChannels)
          .where(and(eq(sectionChannels.channelId, channelId), eq(sectionChannels.userId, userId)))
        await tx
          .delete(favorites)
          .where(and(eq(favorites.channelId, channelId), eq(favorites.userId, userId)))
        await this.refreshMemberCount(tx, channelId)
        // keep the channel manageable: promote the oldest remaining member if no owner/admin is left
        if (MANAGER_ROLES.has(a.member.role)) {
          const managers = await tx
            .select({ u: channelMembers.userId })
            .from(channelMembers)
            .where(
              and(eq(channelMembers.channelId, channelId), inArray(channelMembers.role, ['owner', 'admin'])),
            )
            .limit(1)
          if (!managers.length) {
            const [oldest] = await tx
              .select({ u: channelMembers.userId })
              .from(channelMembers)
              .where(eq(channelMembers.channelId, channelId))
              .orderBy(asc(channelMembers.joinedAt))
              .limit(1)
            if (oldest)
              await tx
                .update(channelMembers)
                .set({ role: 'owner' })
                .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, oldest.u)))
          }
        }
        return { removed: true, type: a.channel.type }
      },
      principal.userId,
    )
    if (!removed) return
    await this.kernel.emit(
      chatEvents.memberRemoved,
      { channelId, workspaceId, type, userId, removedBy: principal.userId } as never,
      { workspaceId, actorId: principal.userId },
    )
    await this.kernel.realtime.toUser(userId, {
      t: 'change',
      workspaceId,
      change: { module: MODULE_ID, entity: 'channel', id: channelId, op: 'deleted' },
    } as never)
    await this.kernel.realtime.toChannel(rtChannel.chat(channelId), {
      t: 'change',
      workspaceId,
      change: {
        module: MODULE_ID,
        entity: 'channel_member',
        id: channelId,
        op: 'deleted',
        patch: { userId },
      },
    } as never)
    if (type !== 'group_dm')
      await this.messages
        .postSystem({
          workspaceId,
          channelId,
          actorId: userId,
          event: self ? 'left' : 'removed',
          text: self ? 'left the channel' : 'was removed from the channel',
          data: self ? {} : { by: principal.userId },
        })
        .catch(() => {})
  }

  async setRole(
    workspaceId: string,
    principal: Principal,
    channelId: string,
    userId: string,
    role: ChannelMember['role'],
  ): Promise<ChannelMember> {
    return withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const a = await this.requireReadable(tx, principal, workspaceId, channelId)
        await this.requireManage(principal, a)
        const [row] = await tx
          .update(channelMembers)
          .set({ role })
          .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
          .returning()
        if (!row) throw KernError.notFound('Member')
        return toMember(row)
      },
      principal.userId,
    )
  }

  async updateMembership(
    workspaceId: string,
    principal: Principal,
    channelId: string,
    patch: { muted?: boolean; notifyLevel?: NotifyLevel },
  ): Promise<ChannelMember> {
    const userId = principal.userId
    if (!userId) throw KernError.unauthorized()
    const m = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        await this.requireMember(tx, principal, workspaceId, channelId)
        const [row] = await tx
          .update(channelMembers)
          .set({
            ...(patch.muted !== undefined ? { muted: patch.muted } : {}),
            ...(patch.notifyLevel ? { notifyLevel: patch.notifyLevel } : {}),
          })
          .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
          .returning()
        return toMember(row!)
      },
      userId,
    )
    await this.kernel.realtime.toUser(userId, {
      t: 'change',
      workspaceId,
      change: {
        module: MODULE_ID,
        entity: 'channel',
        id: channelId,
        op: 'updated',
        patch: { membership: m },
      },
    } as never)
    await this.pushBadges(workspaceId, [userId])
    return m
  }

  async openDm(workspaceId: string, principal: Principal, otherUserId: string): Promise<ChannelView> {
    const me = principal.userId
    if (!me) throw KernError.unauthorized()
    return this.ensureDm(workspaceId, me, [me, otherUserId], otherUserId === me ? 'dm' : 'dm')
  }

  async createGroupDm(workspaceId: string, principal: Principal, userIds: string[]): Promise<ChannelView> {
    const me = principal.userId
    if (!me) throw KernError.unauthorized()
    const all = [...new Set([me, ...userIds])]
    if (all.length < 3) return this.ensureDm(workspaceId, me, all, 'dm')
    return this.ensureDm(workspaceId, me, all, 'group_dm')
  }

  private async ensureDm(
    workspaceId: string,
    me: string,
    userIds: string[],
    type: 'dm' | 'group_dm',
  ): Promise<ChannelView> {
    // TODO: validate that every participant is an active member of the workspace (core.workspaces.members) once core exposes a cheap check.
    const key = dmKey(userIds)
    const { view, created } = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(channels)
          .where(and(eq(channels.workspaceId, workspaceId), eq(channels.dmKey, key)))
          .limit(1)
        if (existing)
          return {
            view: await this.view(tx, await this.load(tx, workspaceId, existing.id, me), me),
            created: false,
          }
        const id = uuidv7()
        const [row] = await tx
          .insert(channels)
          .values({ id, workspaceId, type, name: null, slug: null, dmKey: key, createdBy: me })
          .onConflictDoNothing()
          .returning()
        if (!row) {
          const [again] = await tx
            .select()
            .from(channels)
            .where(and(eq(channels.workspaceId, workspaceId), eq(channels.dmKey, key)))
            .limit(1)
          return {
            view: await this.view(tx, await this.load(tx, workspaceId, again!.id, me), me),
            created: false,
          }
        }
        await this.insertMembers(tx, row, [...new Set(userIds)], me, { notifyLevel: 'all' })
        return { view: await this.view(tx, await this.load(tx, workspaceId, id, me), me), created: true }
      },
      me,
    )
    if (created) {
      await this.kernel.emit(
        chatEvents.channelCreated,
        { channelId: view.id, workspaceId, type, name: null, createdBy: me } as never,
        { workspaceId, actorId: me },
      )
      await this.announceChannel(view, 'created')
    }
    return view
  }

  async ensureObjectChannel(
    workspaceId: string,
    actorId: string | null,
    objectRef: ObjectRef,
    name: string,
    memberIds: string[],
  ): Promise<ChannelView> {
    const { view, created, added } = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(channels)
          .where(
            and(
              eq(channels.workspaceId, workspaceId),
              eq(channels.objectModule, objectRef.module),
              eq(channels.objectType, objectRef.type),
              eq(channels.objectId, objectRef.id),
            ),
          )
          .limit(1)
        let row = existing
        let created = false
        if (!row) {
          const id = uuidv7()
          const [ins] = await tx
            .insert(channels)
            .values({
              id,
              workspaceId,
              type: 'object',
              name,
              slug: null,
              objectModule: objectRef.module,
              objectType: objectRef.type,
              objectId: objectRef.id,
              createdBy: actorId,
            })
            .onConflictDoNothing()
            .returning()
          row =
            ins ??
            (
              await tx
                .select()
                .from(channels)
                .where(
                  and(
                    eq(channels.workspaceId, workspaceId),
                    eq(channels.objectModule, objectRef.module),
                    eq(channels.objectType, objectRef.type),
                    eq(channels.objectId, objectRef.id),
                  ),
                )
                .limit(1)
            )[0]
          created = !!ins
        }
        const added = await this.insertMembers(
          tx,
          row!,
          [...new Set([...(actorId ? [actorId] : []), ...memberIds])],
          actorId,
          { ownerId: created ? actorId : null },
        )
        return {
          view: await this.view(tx, await this.load(tx, workspaceId, row!.id, actorId), actorId),
          created,
          added,
        }
      },
      actorId,
    )
    if (created) {
      await this.kernel.emit(
        chatEvents.channelCreated,
        { channelId: view.id, workspaceId, type: 'object', name, createdBy: actorId } as never,
        { workspaceId, actorId },
      )
      await this.announceChannel(view, 'created')
    } else if (added.length)
      await this.afterMembersAdded(workspaceId, view.id, 'object', added, actorId, 'added', true)
    return view
  }

  // ------------------------------------------------------------------ read state

  async markRead(
    workspaceId: string,
    principal: Principal,
    channelId: string,
    messageId?: string,
  ): Promise<ChannelMember> {
    const userId = principal.userId
    if (!userId) throw KernError.unauthorized()
    const m = await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const a = await this.requireMember(tx, principal, workspaceId, channelId)
        let seq = Number(a.channel.lastSeq)
        let lastId: string | null = null
        if (messageId) {
          const r = await tx.execute<{ seq: string; id: string }>(
            sql`select id, seq from mod_chat.messages where id = ${messageId} and channel_id = ${channelId}`,
          )
          if (!r.rows[0]) throw KernError.notFound('Message')
          seq = Number(r.rows[0].seq)
          lastId = r.rows[0].id
        } else {
          const r = await tx.execute<{ id: string }>(
            sql`select id from mod_chat.messages where channel_id = ${channelId} and thread_root_id is null order by seq desc limit 1`,
          )
          lastId = r.rows[0]?.id ?? null
        }
        const [row] = await tx
          .update(channelMembers)
          .set({
            lastReadSeq: seq,
            lastReadMessageId: lastId,
            lastReadAt: new Date(),
            unreadCount: sql`(select count(*)::int from mod_chat.messages x where x.channel_id = ${channelId} and x.seq > ${seq} and x.thread_root_id is null and x.deleted_at is null and x.author_id is distinct from ${userId}::uuid)`,
            mentionCount: sql`(select count(*)::int from mod_chat.messages x where x.channel_id = ${channelId} and x.seq > ${seq} and x.deleted_at is null and x.author_id is distinct from ${userId}::uuid and (x.mentions->'users' ? ${userId} or (x.mentions->>'channel')::boolean))`,
          })
          .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
          .returning()
        return toMember(row!)
      },
      userId,
    )
    await this.kernel.realtime.toUser(userId, {
      t: 'change',
      workspaceId,
      change: {
        module: MODULE_ID,
        entity: 'channel',
        id: channelId,
        op: 'updated',
        patch: {
          unreadCount: m.unreadCount,
          mentionCount: m.mentionCount,
          lastReadSeq: m.lastReadSeq,
          lastReadMessageId: m.lastReadMessageId,
        },
      },
    } as never)
    await this.pushBadges(workspaceId, [userId])
    return m
  }

  async unread(workspaceId: string, userId: string): Promise<UnreadSummary> {
    return withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const rows = await tx
          .select({
            channelId: channelMembers.channelId,
            unreadCount: channelMembers.unreadCount,
            mentionCount: channelMembers.mentionCount,
            muted: channelMembers.muted,
          })
          .from(channelMembers)
          .innerJoin(channels, eq(channels.id, channelMembers.channelId))
          .where(
            and(
              eq(channelMembers.workspaceId, workspaceId),
              eq(channelMembers.userId, userId),
              isNull(channels.archivedAt),
            ),
          )
        const totals = rows.reduce(
          (acc, r) =>
            r.muted ? acc : { unread: acc.unread + r.unreadCount, mentions: acc.mentions + r.mentionCount },
          { unread: 0, mentions: 0 },
        )
        return { channels: rows, totals }
      },
      userId,
    )
  }

  /** Workspace-level badge totals (non-muted, non-archived) for a set of users. */
  async badgeTotals(
    tx: Tx,
    workspaceId: string,
    userIds: string[],
  ): Promise<Map<string, { unread: number; mentions: number }>> {
    const map = new Map<string, { unread: number; mentions: number }>()
    if (!userIds.length) return map
    const res = await tx.execute<{ user_id: string; unread: string; mentions: string }>(sql`
      select cm.user_id, coalesce(sum(cm.unread_count),0)::int as unread, coalesce(sum(cm.mention_count),0)::int as mentions
      from mod_chat.channel_members cm join mod_chat.channels c on c.id = cm.channel_id
      where cm.workspace_id = ${workspaceId} and cm.user_id = any(${userIds}::uuid[]) and cm.muted = false and c.archived_at is null
      group by cm.user_id`)
    for (const u of userIds) map.set(u, { unread: 0, mentions: 0 })
    for (const r of res.rows) map.set(r.user_id, { unread: Number(r.unread), mentions: Number(r.mentions) })
    return map
  }

  async pushBadges(workspaceId: string, userIds: string[], tx?: Tx) {
    if (!userIds.length) return
    const totals = tx
      ? await this.badgeTotals(tx, workspaceId, userIds)
      : await withWs(this.kernel, workspaceId, (t) => this.badgeTotals(t, workspaceId, userIds))
    await Promise.all(
      [...totals].map(([userId, t]) =>
        this.kernel.realtime.toUser(userId, {
          t: 'badge',
          workspaceId,
          unread: t.unread,
          mentions: t.mentions,
        } as never),
      ),
    )
  }

  // ------------------------------------------------------------------ favorites & sections

  async setFavorite(workspaceId: string, principal: Principal, channelId: string, favorite: boolean) {
    const userId = principal.userId
    if (!userId) throw KernError.unauthorized()
    await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        await this.requireReadable(tx, principal, workspaceId, channelId)
        if (favorite)
          await tx.insert(favorites).values({ workspaceId, userId, channelId }).onConflictDoNothing()
        else
          await tx
            .delete(favorites)
            .where(and(eq(favorites.userId, userId), eq(favorites.channelId, channelId)))
      },
      userId,
    )
  }

  async createSection(workspaceId: string, userId: string, name: string): Promise<ChannelSection> {
    return withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const max =
          (
            await tx.execute<{ max: number | null }>(
              sql`select max(position) as max from mod_chat.channel_sections where workspace_id = ${workspaceId} and user_id = ${userId}`,
            )
          ).rows[0]?.max ?? null
        const [row] = await tx
          .insert(channelSections)
          .values({ id: uuidv7(), workspaceId, userId, name, position: (max ?? -1) + 1 })
          .returning()
        return toSection(row!, [])
      },
      userId,
    )
  }
  async updateSection(
    workspaceId: string,
    userId: string,
    sectionId: string,
    patch: { name?: string; collapsed?: boolean },
  ): Promise<ChannelSection> {
    return withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        const [row] = await tx
          .update(channelSections)
          .set(patch)
          .where(and(eq(channelSections.id, sectionId), eq(channelSections.userId, userId)))
          .returning()
        if (!row) throw KernError.notFound('Section')
        const chs = await tx
          .select({ c: sectionChannels.channelId })
          .from(sectionChannels)
          .where(eq(sectionChannels.sectionId, sectionId))
          .orderBy(asc(sectionChannels.position))
        return toSection(
          row,
          chs.map((c) => c.c),
        )
      },
      userId,
    )
  }
  async deleteSection(workspaceId: string, userId: string, sectionId: string) {
    await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        await tx
          .delete(sectionChannels)
          .where(and(eq(sectionChannels.sectionId, sectionId), eq(sectionChannels.userId, userId)))
        await tx
          .delete(channelSections)
          .where(and(eq(channelSections.id, sectionId), eq(channelSections.userId, userId)))
      },
      userId,
    )
  }
  async reorderSections(
    workspaceId: string,
    userId: string,
    sectionIds: string[],
  ): Promise<ChannelSection[]> {
    return withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        for (const [i, id] of sectionIds.entries())
          await tx
            .update(channelSections)
            .set({ position: i })
            .where(and(eq(channelSections.id, id), eq(channelSections.userId, userId)))
        const rows = await tx
          .select()
          .from(channelSections)
          .where(and(eq(channelSections.workspaceId, workspaceId), eq(channelSections.userId, userId)))
          .orderBy(asc(channelSections.position))
        const chs = await tx
          .select()
          .from(sectionChannels)
          .where(and(eq(sectionChannels.workspaceId, workspaceId), eq(sectionChannels.userId, userId)))
          .orderBy(asc(sectionChannels.position))
        return rows.map((s) =>
          toSection(
            s,
            chs.filter((c) => c.sectionId === s.id).map((c) => c.channelId),
          ),
        )
      },
      userId,
    )
  }
  async setSectionChannel(
    workspaceId: string,
    userId: string,
    channelId: string,
    sectionId: string | null,
    position?: number,
  ) {
    await withWs(
      this.kernel,
      workspaceId,
      async (tx) => {
        await tx
          .delete(sectionChannels)
          .where(and(eq(sectionChannels.userId, userId), eq(sectionChannels.channelId, channelId)))
        if (!sectionId) return
        const [sec] = await tx
          .select()
          .from(channelSections)
          .where(and(eq(channelSections.id, sectionId), eq(channelSections.userId, userId)))
          .limit(1)
        if (!sec) throw KernError.notFound('Section')
        await tx
          .insert(sectionChannels)
          .values({ sectionId, channelId, workspaceId, userId, position: position ?? 0 })
      },
      userId,
    )
  }

  // ------------------------------------------------------------------ workspace lifecycle (event handlers)

  /** `#general` (auto-join) + `#random` for a new workspace. */
  async bootstrapWorkspace(workspaceId: string, createdBy: string) {
    const principal = {
      ...this.kernel.system,
      userId: createdBy as Principal['userId'],
      kind: 'service' as const,
    }
    const existing = await withWs(this.kernel, workspaceId, (tx) =>
      tx
        .select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.workspaceId, workspaceId), eq(channels.slug, 'general')))
        .limit(1),
    )
    if (existing.length) return
    await this.create(workspaceId, principal, {
      name: 'general',
      type: 'public',
      purpose: 'Workspace-wide announcements and conversation',
      autoJoin: true,
    })
    await this.create(workspaceId, principal, {
      name: 'random',
      type: 'public',
      purpose: 'Non-work banter and water cooler conversation',
      autoJoin: true,
    })
  }

  async joinAutoChannels(workspaceId: string, userId: string) {
    const ids = await withWs(this.kernel, workspaceId, (tx) =>
      tx
        .select({ id: channels.id, type: channels.type })
        .from(channels)
        .where(
          and(
            eq(channels.workspaceId, workspaceId),
            eq(channels.autoJoin, true),
            isNull(channels.archivedAt),
          ),
        ),
    )
    for (const c of ids) {
      const added = await withWs(this.kernel, workspaceId, async (tx) =>
        this.insertMembers(tx, (await this.load(tx, workspaceId, c.id, null)).channel, [userId], null, {}),
      )
      if (added.length) await this.afterMembersAdded(workspaceId, c.id, c.type, added, null, 'joined')
    }
  }

  async removeFromWorkspace(workspaceId: string, userId: string) {
    const ids = await withWs(this.kernel, workspaceId, (tx) =>
      tx
        .select({ id: channelMembers.channelId })
        .from(channelMembers)
        .where(and(eq(channelMembers.workspaceId, workspaceId), eq(channelMembers.userId, userId))),
    )
    for (const c of ids)
      await this.removeMember(workspaceId, this.kernel.system, c.id, userId).catch((err) =>
        this.kernel.log.warn({ err, channelId: c.id }, 'remove member failed'),
      )
  }

  // ------------------------------------------------------------------ internals

  private async uniqueSlug(tx: Tx, workspaceId: string, base: string, exceptId?: string) {
    for (let i = 0; i < 50; i++) {
      const slug = i === 0 ? base : `${base}-${i + 1}`
      const hit = await tx
        .select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.workspaceId, workspaceId), eq(channels.slug, slug)))
        .limit(1)
      if (!hit.length || hit[0]!.id === exceptId) return slug
    }
    return `${base}-${uuidv7().slice(-6)}`
  }

  /** Insert memberships (idempotent); new members start "caught up" (lastReadSeq = channel.lastSeq). Returns the user ids actually added. */
  async insertMembers(
    tx: Tx,
    ch: ChannelRow,
    userIds: string[],
    _actorId: string | null,
    opts: { ownerId?: string | null; notifyLevel?: NotifyLevel },
  ): Promise<string[]> {
    const ids = [...new Set(userIds)].filter(Boolean)
    if (!ids.length) return []
    const inserted = await tx
      .insert(channelMembers)
      .values(
        ids.map((userId) => ({
          channelId: ch.id,
          workspaceId: ch.workspaceId,
          userId,
          role: userId === opts.ownerId ? 'owner' : 'member',
          lastReadSeq: Number(ch.lastSeq),
          notifyLevel: opts.notifyLevel ?? (ch.type === 'dm' || ch.type === 'group_dm' ? 'all' : 'mentions'),
        })),
      )
      .onConflictDoNothing()
      .returning({ userId: channelMembers.userId })
    await this.refreshMemberCount(tx, ch.id)
    return inserted.map((r) => r.userId)
  }

  private async refreshMemberCount(tx: Tx, channelId: string) {
    await tx
      .update(channels)
      .set({
        memberCount: sql`(select count(*)::int from mod_chat.channel_members where channel_id = ${channelId})`,
        updatedAt: new Date(),
      })
      .where(eq(channels.id, channelId))
  }

  private async afterMembersAdded(
    workspaceId: string,
    channelId: string,
    type: string,
    added: string[],
    actorId: string | null,
    how: 'joined' | 'added',
    quiet = false,
  ) {
    await this.kernel.emit(
      chatEvents.memberAdded,
      { channelId, workspaceId, type, userIds: added, addedBy: actorId } as never,
      { workspaceId, actorId },
    )
    // the new members learn about the channel; existing subscribers learn about the member change
    await this.kernel.realtime.toUsers(added, {
      t: 'change',
      workspaceId,
      change: { module: MODULE_ID, entity: 'channel', id: channelId, op: 'created' },
    } as never)
    await this.kernel.realtime.toChannel(rtChannel.chat(channelId), {
      t: 'change',
      workspaceId,
      change: {
        module: MODULE_ID,
        entity: 'channel_member',
        id: channelId,
        op: 'created',
        patch: { userIds: added },
      },
    } as never)
    if (quiet || type === 'dm' || type === 'group_dm') return
    const names = await this.users.getMany(added)
    const list = added.map((u) => names.get(u)?.name ?? 'someone')
    const text = how === 'joined' ? 'joined the channel' : `added ${list.join(', ')} to the channel`
    await this.messages
      .postSystem({
        workspaceId,
        channelId,
        actorId: how === 'joined' ? added[0]! : actorId,
        event: how,
        text,
        data: { userIds: added },
      })
      .catch(() => {})
  }

  private async announceChannel(view: ChannelView, op: 'created' | 'updated') {
    const change = {
      module: MODULE_ID,
      entity: 'channel',
      id: view.id,
      op,
      patch: view as unknown as Record<string, unknown>,
    } as const
    if (view.type === 'public') await this.kernel.realtime.change(view.workspaceId, change)
    else {
      const members =
        view.type === 'dm' || view.type === 'group_dm'
          ? view.dmUserIds
          : await withWs(this.kernel, view.workspaceId, (tx) => this.memberIds(tx, view.id))
      await this.kernel.realtime.toUsers(members, {
        t: 'change',
        workspaceId: view.workspaceId,
        change,
      } as never)
    }
  }
}

export const objectScope = (ch: ChannelRow) => ({
  kind: 'object' as const,
  id: ch.id,
  workspaceId: ch.workspaceId,
  parents: [{ kind: 'workspace' as const, id: ch.workspaceId }],
})

function syntheticMember(ch: ChannelRow, principal: Principal): MemberRow {
  return {
    channelId: ch.id,
    workspaceId: ch.workspaceId,
    userId: (principal.userId ?? '00000000-0000-0000-0000-000000000000') as string,
    role: 'owner',
    lastReadMessageId: null,
    lastReadSeq: 0,
    lastReadAt: null,
    unreadCount: 0,
    mentionCount: 0,
    muted: false,
    notifyLevel: 'none',
    joinedAt: new Date(),
  }
}
