/**
 * In-memory implementation of the chat API.
 *
 * Enabled with `PUBLIC_API_MOCK=1` (`pnpm dev:mock`), like the core and tracker mocks, so the
 * conversation views can be built, demoed and tested without Postgres, NATS and the chat service —
 * and so the end-to-end tests have a deterministic backend. It implements the shapes the store
 * calls; anything it does not implement throws rather than quietly returning nothing.
 *
 * The people and workspace ids match `$lib/api/mock` on purpose: the demo is one coherent place,
 * where the person who assigned you an issue is the same person who is typing at you in chat.
 */

const now = Date.now()
const iso = (msAgo = 0) => new Date(now - msAgo).toISOString()
/** same id scheme as the core mock, in a distinct block so nothing collides */
const id = (n: number) => `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`
const cid = (n: number) => `01920000-0000-7000-8001-${String(n).padStart(12, '0')}`
const mid = (n: number) => `01920000-0000-7000-8002-${String(n).padStart(12, '0')}`

const WORKSPACE = id(10)
const ME = id(1)
const DAN = id(2)
const TOMAS = id(3)
const INES = id(4)

type Json = Record<string, unknown>

const doc = (text: string): Json => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

interface MockMessage {
  id: string
  channelId: string
  workspaceId: string
  authorId: string | null
  kind: 'user' | 'system' | 'bot'
  threadRootId: string | null
  body: Json
  bodyText: string
  mentions: { users: string[]; groups: string[]; channel: boolean }
  attachments: string[]
  reactions: Array<{ emoji: string; count: number; userIds: string[] }>
  replyCount: number
  lastReplyAt: string | null
  editedAt: string | null
  deletedAt: string | null
  pinned: boolean
  seq: number
  createdAt: string
  metadata: Json
}

interface MockChannel {
  id: string
  workspaceId: string
  type: 'public' | 'private' | 'dm' | 'group_dm' | 'object'
  name: string | null
  slug: string | null
  topic: string | null
  purpose: string | null
  objectRef: { module: string; type: string; id: string } | null
  autoJoin: boolean
  createdBy: string | null
  archivedAt: string | null
  memberCount: number
  lastMessageAt: string | null
  lastSeq: number
  createdAt: string
  updatedAt: string
  // membership of the signed-in person; null when they have not joined
  joined: boolean
  favorite: boolean
  sectionId: string | null
  dmUserIds: string[]
  unreadCount: number
  mentionCount: number
  muted: boolean
}

const channel = (over: Partial<MockChannel> & Pick<MockChannel, 'id' | 'type'>): MockChannel => ({
  workspaceId: WORKSPACE,
  name: null,
  slug: null,
  topic: null,
  purpose: null,
  objectRef: null,
  autoJoin: false,
  createdBy: ME,
  archivedAt: null,
  memberCount: 1,
  lastMessageAt: null,
  lastSeq: 0,
  createdAt: iso(30 * 864e5),
  updatedAt: iso(864e5),
  joined: true,
  favorite: false,
  sectionId: null,
  dmUserIds: [],
  unreadCount: 0,
  mentionCount: 0,
  muted: false,
  ...over,
})

export function createMockChatApi() {
  const channels: MockChannel[] = [
    channel({
      id: cid(1),
      type: 'public',
      name: 'eng-core',
      slug: 'eng-core',
      topic: 'Kernel, contracts and the module runtime',
      memberCount: 14,
      autoJoin: true,
      favorite: true,
    }),
    channel({
      id: cid(2),
      type: 'public',
      name: 'design',
      slug: 'design',
      topic: 'Ink & paper — the design system',
      memberCount: 9,
    }),
    channel({
      id: cid(3),
      type: 'private',
      name: 'launch-room',
      slug: 'launch-room',
      topic: 'v1.0 release coordination',
      memberCount: 5,
    }),
    channel({ id: cid(4), type: 'dm', dmUserIds: [ME, DAN], memberCount: 2 }),
    channel({ id: cid(5), type: 'dm', dmUserIds: [ME, INES], memberCount: 2 }),
    channel({
      id: cid(6),
      type: 'group_dm',
      dmUserIds: [ME, DAN, TOMAS],
      memberCount: 3,
    }),
    // a channel the person has not joined, so "browse" has something to offer
    channel({
      id: cid(7),
      type: 'public',
      name: 'random',
      slug: 'random',
      topic: 'Anything that is not work',
      memberCount: 21,
      joined: false,
    }),
  ]

  const sections = [
    {
      id: cid(90),
      workspaceId: WORKSPACE,
      userId: ME,
      name: 'Starred',
      position: 0,
      collapsed: false,
      channelIds: [cid(1)],
    },
  ]

  const messages: MockMessage[] = []
  let seqCounter = 0
  let messageCounter = 0

  const say = (
    channelId: string,
    authorId: string | null,
    text: string,
    over: Partial<MockMessage> = {},
  ): MockMessage => {
    const ch = channels.find((c) => c.id === channelId)!
    ch.lastSeq += 1
    messageCounter += 1
    seqCounter += 1
    const msg: MockMessage = {
      id: mid(messageCounter),
      channelId,
      workspaceId: WORKSPACE,
      authorId,
      kind: authorId ? 'user' : 'system',
      threadRootId: null,
      body: doc(text),
      bodyText: text,
      mentions: { users: [], groups: [], channel: false },
      attachments: [],
      reactions: [],
      replyCount: 0,
      lastReplyAt: null,
      editedAt: null,
      deletedAt: null,
      pinned: false,
      seq: ch.lastSeq,
      createdAt: iso((200 - seqCounter) * 60_000),
      metadata: {},
      ...over,
    }
    messages.push(msg)
    ch.lastMessageAt = msg.createdAt
    return msg
  }

  say(cid(1), DAN, 'The module runtime now mounts every router under /api/<id>. One line per module.')
  say(cid(1), TOMAS, 'Does that mean the tracker is reachable without its own service?')
  say(cid(1), DAN, 'Yes — core hosts it. Nothing else changes: Caddy already routes /api/* there.', {
    reactions: [{ emoji: '🎉', count: 2, userIds: [ME, TOMAS] }],
  })
  const rootWithThread = say(
    cid(1),
    ME,
    'Let us keep the migration notes in the same commit as the change.',
    {
      replyCount: 2,
      lastReplyAt: iso(40 * 60_000),
    },
  )
  say(cid(1), TOMAS, 'Agreed. A stale note is worse than none.', {
    threadRootId: rootWithThread.id,
    createdAt: iso(45 * 60_000),
  })
  say(cid(1), DAN, 'I will add it to CLAUDE.md.', {
    threadRootId: rootWithThread.id,
    createdAt: iso(40 * 60_000),
  })
  say(cid(1), INES, 'Pinning the release checklist here so nobody has to hunt for it.', { pinned: true })

  say(cid(2), INES, 'The dialog now focuses the first field instead of the close button.')
  say(cid(2), ME, 'Good. A space should never throw away what someone typed.')

  say(cid(3), DAN, 'Release candidate is cut. Smoke tests running.')

  say(cid(4), DAN, 'Do you have five minutes to look at the permission matrix?')
  say(cid(4), ME, 'Yes — after standup.')

  say(cid(5), INES, 'Sent you the RTL screenshots.')

  say(cid(6), TOMAS, 'Adding you both so we stop forking the thread.')

  // unread state the sidebar can show
  const eng = channels.find((c) => c.id === cid(1))!
  eng.unreadCount = 3
  eng.mentionCount = 1
  const dmDan = channels.find((c) => c.id === cid(4))!
  dmDan.unreadCount = 1

  const bookmarks = new Set<string>()

  const viewOf = (c: MockChannel) => ({
    id: c.id,
    workspaceId: c.workspaceId,
    type: c.type,
    name: c.name,
    slug: c.slug,
    topic: c.topic,
    purpose: c.purpose,
    objectRef: c.objectRef,
    autoJoin: c.autoJoin,
    createdBy: c.createdBy,
    archivedAt: c.archivedAt,
    memberCount: c.memberCount,
    lastMessageAt: c.lastMessageAt,
    lastSeq: c.lastSeq,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    favorite: c.favorite,
    sectionId: c.sectionId,
    dmUserIds: c.dmUserIds,
    membership: c.joined
      ? {
          channelId: c.id,
          userId: ME,
          role: 'member' as const,
          lastReadMessageId: null,
          lastReadSeq: Math.max(0, c.lastSeq - c.unreadCount),
          lastReadAt: iso(3600_000),
          unreadCount: c.unreadCount,
          mentionCount: c.mentionCount,
          muted: c.muted,
          notifyLevel: 'all' as const,
          joinedAt: c.createdAt,
        }
      : null,
  })

  const find = (channelId: string) => {
    const c = channels.find((x) => x.id === channelId)
    if (!c) throw new Error(`mock chat: no channel ${channelId}`)
    return c
  }
  const findMessage = (messageId: string) => {
    const m = messages.find((x) => x.id === messageId)
    if (!m) throw new Error(`mock chat: no message ${messageId}`)
    return m
  }
  const inChannel = (channelId: string) =>
    messages
      .filter((m) => m.channelId === channelId && !m.threadRootId && !m.deletedAt)
      .sort((a, b) => a.seq - b.seq)

  return {
    channels: {
      async list() {
        return { items: channels.filter((c) => c.joined).map(viewOf), sections }
      },
      async get({ channelId }: { channelId: string }) {
        return viewOf(find(channelId))
      },
      async browse({ q }: { q?: string } = {}) {
        const needle = (q ?? '').toLowerCase()
        return {
          items: channels
            .filter((c) => c.type === 'public' || c.type === 'private')
            .filter((c) => !needle || (c.name ?? '').toLowerCase().includes(needle))
            .map((c) => ({ ...viewOf(c), joined: c.joined })),
        }
      },
      async create(input: { name: string; type: 'public' | 'private'; topic?: string }) {
        const c = channel({
          id: cid(100 + channels.length),
          type: input.type,
          name: input.name,
          slug: input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          topic: input.topic ?? null,
          createdAt: iso(0),
          updatedAt: iso(0),
        })
        channels.push(c)
        return viewOf(c)
      },
      async update({ channelId, patch }: { channelId: string; patch: Partial<MockChannel> }) {
        Object.assign(find(channelId), patch, { updatedAt: iso(0) })
        return viewOf(find(channelId))
      },
      async archive({ channelId }: { channelId: string }) {
        find(channelId).archivedAt = iso(0)
        return { ok: true }
      },
      async join({ channelId }: { channelId: string }) {
        const c = find(channelId)
        c.joined = true
        c.memberCount += 1
        return viewOf(c)
      },
      async leave({ channelId }: { channelId: string }) {
        const c = find(channelId)
        c.joined = false
        c.memberCount = Math.max(0, c.memberCount - 1)
        return { ok: true }
      },
      async members({ channelId }: { channelId: string }) {
        const c = find(channelId)
        const ids = c.dmUserIds.length ? c.dmUserIds : [ME, DAN, TOMAS, INES]
        return {
          items: ids.map((userId) => ({
            channelId: c.id,
            userId,
            role: userId === ME ? ('owner' as const) : ('member' as const),
            lastReadMessageId: null,
            lastReadSeq: c.lastSeq,
            lastReadAt: iso(3600_000),
            unreadCount: 0,
            mentionCount: 0,
            muted: false,
            notifyLevel: 'all' as const,
            joinedAt: c.createdAt,
          })),
        }
      },
      async updateMembership({ channelId, muted }: { channelId: string; muted?: boolean }) {
        const c = find(channelId)
        if (muted !== undefined) c.muted = muted
        return viewOf(c).membership
      },
      async openDm({ userId }: { userId: string }) {
        const existing = channels.find(
          (c) => c.type === 'dm' && c.dmUserIds.includes(userId) && c.dmUserIds.includes(ME),
        )
        if (existing) return viewOf(existing)
        const c = channel({
          id: cid(200 + channels.length),
          type: 'dm',
          dmUserIds: [ME, userId],
          memberCount: 2,
          createdAt: iso(0),
        })
        channels.push(c)
        return viewOf(c)
      },
      async createGroupDm({ userIds }: { userIds: string[] }) {
        const c = channel({
          id: cid(300 + channels.length),
          type: 'group_dm',
          dmUserIds: [ME, ...userIds],
          memberCount: userIds.length + 1,
          createdAt: iso(0),
        })
        channels.push(c)
        return viewOf(c)
      },
      async ensureObjectChannel({
        objectRef,
        name,
      }: {
        objectRef: { module: string; type: string; id: string }
        name: string
      }) {
        const existing = channels.find(
          (c) => c.objectRef?.id === objectRef.id && c.objectRef?.module === objectRef.module,
        )
        if (existing) return viewOf(existing)
        const c = channel({
          id: cid(400 + channels.length),
          type: 'object',
          name,
          objectRef,
          memberCount: 2,
          createdAt: iso(0),
        })
        channels.push(c)
        return viewOf(c)
      },
      async markRead({ channelId }: { channelId: string }) {
        const c = find(channelId)
        c.unreadCount = 0
        c.mentionCount = 0
        return viewOf(c).membership
      },
      async unread() {
        return {
          items: channels
            .filter((c) => c.joined && c.unreadCount > 0)
            .map((c) => ({ channelId: c.id, unreadCount: c.unreadCount, mentionCount: c.mentionCount })),
        }
      },
      async favorite({ channelId, favorite }: { channelId: string; favorite: boolean }) {
        find(channelId).favorite = favorite
        return { ok: true }
      },
    },

    sections: {
      async create({ name }: { name: string }) {
        const s = {
          id: cid(500 + sections.length),
          workspaceId: WORKSPACE,
          userId: ME,
          name,
          position: sections.length,
          collapsed: false,
          channelIds: [] as string[],
        }
        sections.push(s)
        return s
      },
      async update({ sectionId, patch }: { sectionId: string; patch: Record<string, unknown> }) {
        const s = sections.find((x) => x.id === sectionId)
        if (!s) throw new Error(`mock chat: no section ${sectionId}`)
        Object.assign(s, patch)
        return s
      },
      async delete({ sectionId }: { sectionId: string }) {
        const i = sections.findIndex((x) => x.id === sectionId)
        if (i >= 0) sections.splice(i, 1)
        return { ok: true }
      },
      async reorder() {
        return { ok: true }
      },
      async setChannel({ channelId, sectionId }: { channelId: string; sectionId: string | null }) {
        find(channelId).sectionId = sectionId
        return { ok: true }
      },
    },

    messages: {
      async list({ channelId, before, limit = 50 }: { channelId: string; before?: number; limit?: number }) {
        const all = inChannel(channelId)
        const upTo = before === undefined ? all : all.filter((m) => m.seq < before)
        const items = upTo.slice(Math.max(0, upTo.length - limit))
        return { items, hasMoreBefore: items.length < upTo.length, hasMoreAfter: false }
      },
      async get({ messageId }: { messageId: string }) {
        return findMessage(messageId)
      },
      async post({
        channelId,
        body,
        threadRootId,
        attachments,
      }: {
        channelId: string
        body: Json
        threadRootId?: string
        attachments?: string[]
      }) {
        const text = plainText(body)
        const msg = say(channelId, ME, text, {
          body,
          threadRootId: threadRootId ?? null,
          attachments: attachments ?? [],
          createdAt: iso(0),
        })
        if (threadRootId) {
          const root = findMessage(threadRootId)
          root.replyCount += 1
          root.lastReplyAt = msg.createdAt
        }
        return msg
      },
      async edit({ messageId, body }: { messageId: string; body: Json }) {
        const msg = findMessage(messageId)
        msg.body = body
        msg.bodyText = plainText(body)
        msg.editedAt = iso(0)
        return msg
      },
      async delete({ messageId }: { messageId: string }) {
        findMessage(messageId).deletedAt = iso(0)
        return { ok: true }
      },
      async thread({ messageId }: { messageId: string }) {
        const root = findMessage(messageId)
        const replies = messages
          .filter((m) => m.threadRootId === messageId && !m.deletedAt)
          .sort((a, b) => a.seq - b.seq)
        return {
          root,
          replies,
          participants: [...new Set([root.authorId, ...replies.map((r) => r.authorId)])].filter(
            (x): x is string => !!x,
          ),
          hasMore: false,
        }
      },
      async react({ messageId, emoji }: { messageId: string; emoji: string }) {
        const msg = findMessage(messageId)
        const existing = msg.reactions.find((r) => r.emoji === emoji)
        let added = true
        if (!existing) {
          msg.reactions = [...msg.reactions, { emoji, count: 1, userIds: [ME] }]
        } else if (existing.userIds.includes(ME)) {
          existing.userIds = existing.userIds.filter((u) => u !== ME)
          existing.count -= 1
          added = false
          if (existing.count <= 0) msg.reactions = msg.reactions.filter((r) => r.emoji !== emoji)
        } else {
          existing.userIds = [...existing.userIds, ME]
          existing.count += 1
        }
        // the contract returns `added` alongside the reactions; the mock used to omit it
        return { reactions: msg.reactions, added }
      },
      async pin({ messageId, pinned }: { messageId: string; pinned: boolean }) {
        findMessage(messageId).pinned = pinned
        return { ok: true }
      },
      async pins({ channelId }: { channelId: string }) {
        return messages.filter((m) => m.channelId === channelId && m.pinned)
      },
      async bookmark({ messageId, bookmarked }: { messageId: string; bookmarked: boolean }) {
        if (bookmarked) bookmarks.add(messageId)
        else bookmarks.delete(messageId)
        return { ok: true }
      },
      async bookmarks() {
        return { items: messages.filter((m) => bookmarks.has(m.id)) }
      },
      async search({ q, limit = 25 }: { q: string; limit?: number }) {
        const needle = q.toLowerCase()
        return {
          items: messages
            .filter((m) => !m.deletedAt && m.bodyText.toLowerCase().includes(needle))
            .slice(0, limit)
            .map((m) => {
              const c = find(m.channelId)
              return { ...m, channel: { id: c.id, type: c.type, name: c.name, slug: c.slug } }
            }),
        }
      },
    },

    commands: {
      /**
       * The built-ins the server handles, so the demo answers a slash command instead of shrugging
       * at it. The old stub returned `{ ok, message }`, which is not the shape the contract
       * describes — nothing called it, so nothing noticed.
       */
      async run({ channelId, command, text }: { channelId: string; command: string; text?: string }) {
        const cmd = command.replace(/^\//, '').toLowerCase()
        const body = (text ?? '').trim()
        switch (cmd) {
          case 'shrug':
            return {
              handled: true,
              ephemeral: null,
              message: say(channelId, ME, `${body} ¯\\_(ツ)_/¯`.trim()),
            }
          case 'me':
            return { handled: true, ephemeral: null, message: say(channelId, ME, body) }
          case 'leave': {
            const c = find(channelId)
            c.joined = false
            c.memberCount = Math.max(0, c.memberCount - 1)
            return { handled: true, ephemeral: 'You left the channel.', message: null }
          }
          case 'topic':
            find(channelId).topic = body || null
            return { handled: true, ephemeral: null, message: null }
          case 'mute':
          case 'unmute':
            find(channelId).muted = cmd === 'mute'
            return {
              handled: true,
              ephemeral: cmd === 'mute' ? 'Channel muted.' : 'Channel unmuted.',
              message: null,
            }
          default:
            return { handled: false, ephemeral: `Unknown command /${cmd}`, message: null }
        }
      },
    },
  }
}

/** The composer writes plain paragraphs, so this is enough to keep previews and search honest. */
function plainText(body: unknown): string {
  const walk = (node: unknown): string => {
    if (!node || typeof node !== 'object') return ''
    const n = node as { type?: string; text?: string; content?: unknown[] }
    if (n.type === 'text') return n.text ?? ''
    return (n.content ?? []).map(walk).join('')
  }
  return walk(body).trim()
}
