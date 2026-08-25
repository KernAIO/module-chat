import { coreApi, navigation, realtime } from '@kernhq/ui'
import { getChatApi } from './api-instance.js'
import type { CoreApi } from './core-api.js'
import { ChatStore } from './store.svelte.js'

/**
 * One conversation store per workspace, shared by everything that draws chat.
 *
 * The conversation list lives in the application sidebar while the transcript lives in the content
 * area — two different places in the component tree that must agree about unread counts, typing and
 * which conversation is open. A store held here, keyed by workspace, is how they agree. It is keyed
 * rather than global because the transcript must never leak from one workspace into another.
 */

const stores = new Map<string, ChatStore>()

export function getChatStore(workspaceId: string, userId: string): ChatStore | null {
  if (!workspaceId || !userId) return null
  const key = `${workspaceId}:${userId}`
  const existing = stores.get(key)
  if (existing) return existing

  const store = new ChatStore({
    api: getChatApi(),
    workspaceId,
    userId,
    realtime: {
      subscribe: (...channels) => realtime.subscribeRaw(...channels),
      unsubscribe: (...channels) => realtime.unsubscribeRaw(...channels),
      typing: (ws, channelId, thread) => realtime.sendTyping(ws, channelId, thread),
    },
    resolveUsers: async (ids) => {
      // The member list answers for almost everyone in one call. Anyone left over is someone this
      // workspace does not list — a guest, a person who left, a direct message with someone you
      // share a different workspace with — and they still need a name, so ask for them by id.
      const api = coreApi<CoreApi>()
      const wanted = new Set(ids)
      const res = await api.workspaces.members.list({ workspaceId, limit: 200 })
      const found = res.items
        .filter((member) => wanted.has(member.userId))
        .map((member) => ({
          id: member.userId as string,
          name: member.user.name || member.user.email,
          username: member.user.username,
          avatarUrl: member.user.avatarUrl,
        }))
      const missing = ids.filter((userId) => !found.some((u) => u.id === userId))
      const rest = await Promise.all(
        missing.map((id) =>
          api.users
            .get({ id })
            .then((user) => ({
              id: user.id as string,
              name: user.name || user.email || id,
              username: user.username ?? null,
              avatarUrl: user.avatarUrl ?? null,
            }))
            .catch(() => null),
        ),
      )
      return [...found, ...rest.filter((u): u is NonNullable<typeof u> => u !== null)]
    },
    navigate: (href) => void navigation.go(href),
  })

  stores.set(key, store)
  return store
}

/** Test seam, and how a sign-out drops every transcript it held. */
export function __clearChatStores() {
  stores.clear()
}
