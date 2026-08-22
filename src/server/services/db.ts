import type { Kernel, Tx } from '@kernalo/kernel'
import { sql } from 'drizzle-orm'
import type {
  Channel,
  ChannelMember,
  ChannelSection,
  Message,
  ReactionSummary,
} from '../../contract/index.js'
import type { channelMembers, channelSections, channels, messages } from '../schema.js'

export type ChannelRow = typeof channels.$inferSelect
export type MemberRow = typeof channelMembers.$inferSelect
export type MessageRow = typeof messages.$inferSelect
export type SectionRow = typeof channelSections.$inferSelect

/** Sentinel accepted by the chat RLS policies for service-internal cross-workspace queries. */
export const ALL_WORKSPACES = '*'

export const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString()
const isoReq = (d: Date | string) => iso(d)!

/** Run `fn` with RLS bound to one workspace. */
export const withWs = <T>(
  kernel: Kernel,
  workspaceId: string,
  fn: (tx: Tx) => Promise<T>,
  userId?: string | null,
) => kernel.database.withWorkspace(workspaceId, fn, { userId: userId ?? null })

/** Run `fn` across all workspaces (gateway access checks, per-user totals). The chat policies allow `app.workspace_id = '*'`. */
export const withAll = <T>(kernel: Kernel, fn: (tx: Tx) => Promise<T>) =>
  kernel.database.withWorkspace(ALL_WORKSPACES, fn)

export function toChannel(r: ChannelRow): Channel {
  return {
    id: r.id,
    workspaceId: r.workspaceId as Channel['workspaceId'],
    type: r.type as Channel['type'],
    name: r.name,
    slug: r.slug,
    topic: r.topic,
    purpose: r.purpose,
    objectRef:
      r.objectId && r.objectModule && r.objectType
        ? { module: r.objectModule, type: r.objectType, id: r.objectId }
        : null,
    autoJoin: r.autoJoin,
    createdBy: r.createdBy as Channel['createdBy'],
    archivedAt: iso(r.archivedAt),
    memberCount: r.memberCount,
    lastMessageAt: iso(r.lastMessageAt),
    lastSeq: Number(r.lastSeq),
    createdAt: isoReq(r.createdAt),
    updatedAt: isoReq(r.updatedAt),
  }
}

export function toMember(r: MemberRow): ChannelMember {
  return {
    channelId: r.channelId,
    userId: r.userId as ChannelMember['userId'],
    role: r.role as ChannelMember['role'],
    lastReadMessageId: r.lastReadMessageId,
    lastReadSeq: Number(r.lastReadSeq),
    lastReadAt: iso(r.lastReadAt),
    unreadCount: r.unreadCount,
    mentionCount: r.mentionCount,
    muted: r.muted,
    notifyLevel: r.notifyLevel as ChannelMember['notifyLevel'],
    joinedAt: isoReq(r.joinedAt),
  }
}

export function toSection(r: SectionRow, channelIds: string[]): ChannelSection {
  return {
    id: r.id,
    workspaceId: r.workspaceId as ChannelSection['workspaceId'],
    userId: r.userId as ChannelSection['userId'],
    name: r.name,
    position: r.position,
    collapsed: r.collapsed,
    channelIds,
  }
}

export function toMessage(r: MessageRow, reactions: ReactionSummary[] = []): Message {
  const deleted = r.deletedAt != null
  return {
    id: r.id,
    channelId: r.channelId,
    workspaceId: r.workspaceId as Message['workspaceId'],
    authorId: r.authorId as Message['authorId'],
    kind: r.kind as Message['kind'],
    threadRootId: r.threadRootId,
    body: deleted ? { type: 'doc', content: [] } : (r.body as Message['body']),
    bodyText: deleted ? '' : r.bodyText,
    mentions: (r.mentions as Message['mentions']) ?? { users: [], groups: [], channel: false },
    attachments: deleted ? [] : ((r.attachments as string[]) ?? []),
    reactions,
    replyCount: r.replyCount,
    lastReplyAt: iso(r.lastReplyAt),
    editedAt: iso(r.editedAt),
    deletedAt: iso(r.deletedAt),
    pinned: r.pinned,
    seq: Number(r.seq),
    createdAt: isoReq(r.createdAt),
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  }
}

/** Aggregate reactions for a set of messages in one query. */
export async function reactionsFor(tx: Tx, messageIds: string[]): Promise<Map<string, ReactionSummary[]>> {
  const map = new Map<string, ReactionSummary[]>()
  if (!messageIds.length) return map
  const rows = await tx.execute<{ message_id: string; emoji: string; count: string; user_ids: string[] }>(sql`
    select message_id, emoji, count(*)::int as count, array_agg(user_id order by created_at) as user_ids
    from mod_chat.message_reactions where message_id = any(${messageIds}::uuid[])
    group by message_id, emoji order by min(created_at)`)
  for (const r of rows.rows) {
    const list = map.get(r.message_id) ?? []
    list.push({ emoji: r.emoji, count: Number(r.count), userIds: r.user_ids as ReactionSummary['userIds'] })
    map.set(r.message_id, list)
  }
  return map
}

export async function hydrateMessages(tx: Tx, rows: MessageRow[]): Promise<Message[]> {
  const reactions = await reactionsFor(
    tx,
    rows.map((r) => r.id),
  )
  return rows.map((r) => toMessage(r, reactions.get(r.id) ?? []))
}

export const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'channel'

/** Stable DM key: sorted participant ids joined by ':'. */
export const dmKey = (userIds: string[]) => [...new Set(userIds)].sort().join(':')
