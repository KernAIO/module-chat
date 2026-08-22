import type { Id, ServerMessage, UserId, WorkspaceId } from '@kernhq/contracts'
import type {
  Channel,
  ChannelSection,
  ChannelView,
  Message,
  MessageWithChannel,
  RichDoc,
  ThreadView,
} from '@kernhq/module-chat/contract'
import type { ChatApi } from './api.js'

export interface UserLite {
  id: string
  name: string
  username?: string | null
  avatarUrl?: string | null
}

export interface RealtimeLike {
  subscribe(...channels: string[]): void
  unsubscribe(...channels: string[]): void
  typing(workspaceId: string, channelId: string, threadId?: string): void
}

export interface ChatStoreOptions {
  api: ChatApi
  workspaceId: string
  /** the signed-in user (author of outgoing messages) */
  userId: string
  realtime?: RealtimeLike
  /** resolve user profiles (usually backed by `core.users.getMany`); results are cached */
  resolveUsers?: (ids: string[]) => Promise<UserLite[]>
  navigate?: (href: string) => void
}

export interface MessageWindow {
  items: Message[]
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  loading: boolean
}

const TYPING_TTL_MS = 4000

/**
 * Client-side chat state (Svelte 5 runes). One instance per open workspace; route components
 * receive it via props. Realtime `ServerMessage`s are applied with `handle()` — the app shell
 * forwards every message from its single WebSocket connection.
 */
export class ChatStore {
  readonly workspaceId: WorkspaceId
  readonly userId: string

  channels = $state<ChannelView[]>([])
  sections = $state<ChannelSection[]>([])
  channelsLoaded = $state(false)
  activeChannelId = $state<string | null>(null)
  windows = $state<Record<string, MessageWindow>>({})
  threads = $state<Record<string, ThreadView>>({})
  openThreadRootId = $state<string | null>(null)
  /** channelId → userId → last typing signal (epoch ms) */
  typing = $state<Record<string, Record<string, number>>>({})
  presence = $state<Record<string, 'online' | 'away' | 'dnd' | 'offline'>>({})
  users = $state<Record<string, UserLite>>({})
  searchResults = $state<MessageWithChannel[] | null>(null)
  searching = $state(false)
  totals = $state({ unread: 0, mentions: 0 })

  private readonly api: ChatApi
  private readonly realtime?: RealtimeLike
  private readonly resolveUsers?: ChatStoreOptions['resolveUsers']
  private readonly pendingUserIds = new Set<string>()
  private lastTypingSentAt = 0
  readonly navigate: (href: string) => void

  constructor(opts: ChatStoreOptions) {
    this.api = opts.api
    this.workspaceId = opts.workspaceId as WorkspaceId
    this.userId = opts.userId
    this.realtime = opts.realtime
    this.resolveUsers = opts.resolveUsers
    this.navigate = opts.navigate ?? (() => {})
  }

  // ---------------------------------------------------------------- channels

  async loadChannels(): Promise<void> {
    const res = await this.api.channels.list({ workspaceId: this.workspaceId, includeArchived: false })
    this.channels = res.items
    this.sections = res.sections
    this.channelsLoaded = true
    this.requestUsers(res.items.flatMap((c) => c.dmUserIds))
    this.recomputeTotals()
  }

  channel(id: string): ChannelView | undefined {
    return this.channels.find((c) => c.id === id)
  }

  /** display name: channel name, or the other DM participants */
  channelLabel(c: ChannelView): string {
    if (c.type === 'dm' || c.type === 'group_dm') {
      const others = c.dmUserIds.filter((u) => u !== this.userId)
      const names = others.map((u) => this.users[u]?.name ?? '…')
      return names.length ? names.join(', ') : (this.users[this.userId]?.name ?? 'You')
    }
    return c.name ?? c.slug ?? 'channel'
  }

  async createChannel(input: { name: string; type: 'public' | 'private'; topic?: string; purpose?: string }) {
    const view = await this.api.channels.create({
      workspaceId: this.workspaceId,
      memberIds: [],
      autoJoin: false,
      ...input,
    })
    this.upsertChannel(view)
    return view
  }

  async joinChannel(channelId: string) {
    const view = await this.api.channels.join({ workspaceId: this.workspaceId, channelId: channelId as Id })
    this.upsertChannel(view)
    return view
  }

  async leaveChannel(channelId: string) {
    await this.api.channels.leave({ workspaceId: this.workspaceId, channelId: channelId as Id })
    this.channels = this.channels.filter((c) => c.id !== channelId)
    delete this.windows[channelId]
  }

  async openDm(userId: string): Promise<ChannelView> {
    const view = await this.api.channels.openDm({ workspaceId: this.workspaceId, userId: userId as UserId })
    this.upsertChannel(view)
    return view
  }

  async browseChannels(q?: string): Promise<Array<Channel & { joined: boolean }>> {
    const res = await this.api.channels.browse({
      workspaceId: this.workspaceId,
      q,
      includeArchived: false,
      limit: 50,
    })
    return res.items
  }

  async setFavorite(channelId: string, favorite: boolean) {
    await this.api.channels.favorite({ workspaceId: this.workspaceId, channelId: channelId as Id, favorite })
    const c = this.channel(channelId)
    if (c) c.favorite = favorite
  }

  async setMuted(channelId: string, muted: boolean) {
    const m = await this.api.channels.updateMembership({
      workspaceId: this.workspaceId,
      channelId: channelId as Id,
      muted,
    })
    const c = this.channel(channelId)
    if (c) c.membership = m
    this.recomputeTotals()
  }

  async ensureObjectChannel(objectRef: { module: string; type: string; id: string }, name: string) {
    const view = await this.api.channels.ensureObjectChannel({
      workspaceId: this.workspaceId,
      objectRef: { module: objectRef.module, type: objectRef.type, id: objectRef.id as Id },
      name,
      memberIds: [],
    })
    this.upsertChannel(view)
    return view
  }

  // ---------------------------------------------------------------- messages

  window(channelId: string): MessageWindow {
    return this.windows[channelId] ?? { items: [], hasMoreBefore: false, hasMoreAfter: false, loading: false }
  }

  async openChannel(channelId: string): Promise<void> {
    this.activeChannelId = channelId
    this.realtime?.subscribe(`chat:${channelId}`)
    if (!this.windows[channelId]) {
      this.windows[channelId] = { items: [], hasMoreBefore: false, hasMoreAfter: false, loading: true }
      const res = await this.api.messages.list({
        workspaceId: this.workspaceId,
        channelId: channelId as Id,
        limit: 50,
      })
      this.windows[channelId] = {
        items: res.items,
        hasMoreBefore: res.hasMoreBefore,
        hasMoreAfter: res.hasMoreAfter,
        loading: false,
      }
      this.requestUsers(res.items.map((m) => m.authorId).filter((x): x is UserId => !!x))
    }
    if (!this.channel(channelId)) {
      try {
        this.upsertChannel(
          await this.api.channels.get({ workspaceId: this.workspaceId, channelId: channelId as Id }),
        )
      } catch {
        /* not readable / gone */
      }
    }
  }

  async loadOlder(channelId: string): Promise<void> {
    const w = this.windows[channelId]
    if (!w || w.loading || !w.hasMoreBefore || !w.items.length) return
    w.loading = true
    try {
      const before = w.items[0]!.seq
      const res = await this.api.messages.list({
        workspaceId: this.workspaceId,
        channelId: channelId as Id,
        before,
        limit: 50,
      })
      w.items = [...res.items, ...w.items]
      w.hasMoreBefore = res.hasMoreBefore
      this.requestUsers(res.items.map((m) => m.authorId).filter((x): x is UserId => !!x))
    } finally {
      w.loading = false
    }
  }

  async post(
    channelId: string,
    body: RichDoc,
    opts: { threadRootId?: string; attachments?: string[]; broadcast?: boolean } = {},
  ) {
    const msg = await this.api.messages.post({
      workspaceId: this.workspaceId,
      channelId: channelId as Id,
      body,
      threadRootId: opts.threadRootId as Id | undefined,
      attachments: (opts.attachments ?? []) as Id[],
      broadcast: opts.broadcast ?? false,
    })
    this.applyMessageCreated(msg)
    return msg
  }

  async editMessage(messageId: string, body: RichDoc) {
    const msg = await this.api.messages.edit({
      workspaceId: this.workspaceId,
      messageId: messageId as Id,
      body,
    })
    this.applyMessagePatch(msg.channelId, messageId, msg as unknown as Record<string, unknown>)
    return msg
  }

  async deleteMessage(channelId: string, messageId: string) {
    await this.api.messages.delete({ workspaceId: this.workspaceId, messageId: messageId as Id })
    this.applyMessageDeleted(channelId, messageId)
  }

  async toggleReaction(messageId: string, channelId: string, emoji: string) {
    const res = await this.api.messages.react({
      workspaceId: this.workspaceId,
      messageId: messageId as Id,
      emoji,
    })
    this.applyMessagePatch(channelId, messageId, { reactions: res.reactions })
    return res
  }

  async togglePin(messageId: string, channelId: string, pinned: boolean) {
    await this.api.messages.pin({ workspaceId: this.workspaceId, messageId: messageId as Id, pinned })
    this.applyMessagePatch(channelId, messageId, { pinned })
  }

  async toggleBookmark(messageId: string, bookmarked: boolean) {
    await this.api.messages.bookmark({
      workspaceId: this.workspaceId,
      messageId: messageId as Id,
      bookmarked,
    })
  }

  async openThread(rootId: string): Promise<ThreadView> {
    this.openThreadRootId = rootId
    const view = await this.api.messages.thread({
      workspaceId: this.workspaceId,
      messageId: rootId as Id,
      limit: 100,
    })
    this.threads[rootId] = view
    this.requestUsers([...view.participants, ...(view.root.authorId ? [view.root.authorId] : [])])
    return view
  }

  closeThread() {
    this.openThreadRootId = null
  }

  async markRead(channelId: string) {
    const m = await this.api.channels.markRead({ workspaceId: this.workspaceId, channelId: channelId as Id })
    const c = this.channel(channelId)
    if (c) c.membership = m
    this.recomputeTotals()
  }

  async search(q: string): Promise<void> {
    if (!q.trim()) {
      this.searchResults = null
      return
    }
    this.searching = true
    try {
      const res = await this.api.messages.search({ workspaceId: this.workspaceId, q, limit: 25 })
      this.searchResults = res.items
      this.requestUsers(res.items.map((m) => m.authorId).filter((x): x is UserId => !!x))
    } finally {
      this.searching = false
    }
  }

  sendTyping(channelId: string, threadId?: string) {
    const now = Date.now()
    if (now - this.lastTypingSentAt < 2000) return
    this.lastTypingSentAt = now
    this.realtime?.typing(this.workspaceId, channelId, threadId)
  }

  typingNames(channelId: string): string[] {
    const now = Date.now()
    const m = this.typing[channelId] ?? {}
    return Object.entries(m)
      .filter(([userId, at]) => userId !== this.userId && now - at < TYPING_TTL_MS)
      .map(([userId]) => this.users[userId]?.name ?? '…')
  }

  // ---------------------------------------------------------------- realtime intake

  /** Apply one realtime message from the gateway. Returns true when it was chat-relevant. */
  handle(msg: ServerMessage): boolean {
    switch (msg.t) {
      case 'typing': {
        const per = this.typing[msg.channelId] ?? {}
        per[msg.userId] = Date.now()
        this.typing[msg.channelId] = { ...per }
        return true
      }
      case 'presence': {
        this.presence[msg.userId] = msg.status
        return true
      }
      case 'badge': {
        if (msg.workspaceId === this.workspaceId) this.totals = { unread: msg.unread, mentions: msg.mentions }
        return true
      }
      case 'change': {
        const ch = msg.change
        if (ch.module !== 'chat') return false
        if (ch.entity === 'message') {
          const channelId = (ch.scope?.channelId as string) ?? this.findChannelOfMessage(ch.id)
          if (ch.op === 'created' && ch.patch) this.applyMessageCreated(ch.patch as unknown as Message)
          else if (ch.op === 'updated' && ch.patch && channelId)
            this.applyMessagePatch(channelId, ch.id, ch.patch)
          else if (ch.op === 'deleted')
            this.applyMessageDeleted((ch.patch?.channelId as string) ?? channelId ?? '', ch.id)
          return true
        }
        if (ch.entity === 'channel') {
          const c = this.channel(ch.id)
          if (ch.op === 'deleted') {
            this.channels = this.channels.filter((x) => x.id !== ch.id)
          } else if (c && ch.patch) {
            Object.assign(c, pickChannelPatch(ch.patch))
            if (ch.patch.membership) c.membership = ch.patch.membership as ChannelView['membership']
            if (typeof ch.patch.unreadCount === 'number' && c.membership)
              c.membership.unreadCount = ch.patch.unreadCount
            if (typeof ch.patch.mentionCount === 'number' && c.membership)
              c.membership.mentionCount = ch.patch.mentionCount
          } else if (!c && ch.op === 'created') {
            void this.refreshChannel(ch.id)
          }
          this.recomputeTotals()
          return true
        }
        if (ch.entity === 'thread' && ch.op === 'updated' && ch.patch) {
          const t = this.threads[ch.id]
          if (t) {
            if (typeof ch.patch.replyCount === 'number') t.root.replyCount = ch.patch.replyCount
            if (typeof ch.patch.lastReplyAt === 'string') t.root.lastReplyAt = ch.patch.lastReplyAt
          }
          return true
        }
        return true
      }
      default:
        return false
    }
  }

  // ---------------------------------------------------------------- internals

  private async refreshChannel(channelId: string) {
    try {
      this.upsertChannel(
        await this.api.channels.get({ workspaceId: this.workspaceId, channelId: channelId as Id }),
      )
    } catch {
      /* raced with delete / not readable */
    }
  }

  private upsertChannel(view: ChannelView) {
    const i = this.channels.findIndex((c) => c.id === view.id)
    if (i >= 0) this.channels[i] = view
    else this.channels = [...this.channels, view]
    this.requestUsers(view.dmUserIds)
  }

  private applyMessageCreated(msg: Message) {
    if (msg.authorId) this.requestUsers([msg.authorId])
    const thread = msg.threadRootId ? this.threads[msg.threadRootId] : null
    if (thread && !thread.replies.some((m) => m.id === msg.id)) {
      thread.replies = [...thread.replies, msg]
    }
    const w = this.windows[msg.channelId]
    const topLevel = !msg.threadRootId || msg.metadata?.broadcast === true
    if (w && topLevel && !w.items.some((m) => m.id === msg.id)) {
      if (!w.hasMoreAfter) w.items = [...w.items, msg]
    }
    const c = this.channel(msg.channelId)
    if (c) {
      c.lastMessageAt = msg.createdAt
      c.lastSeq = Math.max(c.lastSeq, msg.seq)
      if (
        msg.authorId !== this.userId &&
        c.membership &&
        topLevel &&
        msg.kind !== 'system' &&
        msg.channelId !== this.activeChannelId
      ) {
        c.membership.unreadCount += 1
      }
    }
    this.recomputeTotals()
  }

  private applyMessagePatch(channelId: string, messageId: string, patch: Record<string, unknown>) {
    const w = this.windows[channelId]
    const apply = (m: Message) => Object.assign(m, patch)
    if (w) {
      const m = w.items.find((x) => x.id === messageId)
      if (m) apply(m)
    }
    for (const t of Object.values(this.threads)) {
      if (t.root.id === messageId) apply(t.root)
      const r = t.replies.find((x) => x.id === messageId)
      if (r) apply(r)
    }
  }

  private applyMessageDeleted(channelId: string, messageId: string) {
    const patch = {
      deletedAt: new Date().toISOString(),
      bodyText: '',
      body: { type: 'doc', content: [] },
      attachments: [],
      pinned: false,
    }
    this.applyMessagePatch(channelId, messageId, patch)
  }

  private findChannelOfMessage(messageId: string): string | undefined {
    for (const [channelId, w] of Object.entries(this.windows))
      if (w.items.some((m) => m.id === messageId)) return channelId
    return undefined
  }

  private recomputeTotals() {
    let unread = 0
    let mentions = 0
    for (const c of this.channels) {
      if (!c.membership || c.membership.muted || c.archivedAt) continue
      unread += c.membership.unreadCount
      mentions += c.membership.mentionCount
    }
    this.totals = { unread, mentions }
  }

  private requestUsers(ids: string[]) {
    if (!this.resolveUsers) return
    const missing = [...new Set(ids)].filter((id) => id && !this.users[id] && !this.pendingUserIds.has(id))
    if (!missing.length) return
    for (const id of missing) this.pendingUserIds.add(id)
    void this.resolveUsers(missing)
      .then((users) => {
        const next = { ...this.users }
        for (const u of users) next[u.id] = u
        this.users = next
      })
      .catch(() => {})
      .finally(() => {
        for (const id of missing) this.pendingUserIds.delete(id)
      })
  }
}

const CHANNEL_PATCH_KEYS = [
  'name',
  'slug',
  'topic',
  'purpose',
  'archivedAt',
  'autoJoin',
  'memberCount',
  'lastMessageAt',
  'lastSeq',
] as const
function pickChannelPatch(patch: Record<string, unknown>): Partial<Channel> {
  const out: Record<string, unknown> = {}
  for (const k of CHANNEL_PATCH_KEYS) if (k in patch) out[k] = patch[k]
  return out as Partial<Channel>
}
