import type { Kernel } from '@kernalo/kernel'

/**
 * Presence lives in Valkey under `presence:<userId>` with a 60s TTL, refreshed by the realtime
 * gateway on every `presence` client message and heartbeat. A missing/expired key means offline.
 */
export const PRESENCE_KEY_PREFIX = 'presence:'
export const PRESENCE_TTL_SECONDS = 60

export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline'
export interface PresenceEntry {
  userId: string
  status: PresenceStatus
  /** epoch ms of the last signal we saw from any of the user's sockets */
  lastSeen: number | null
}

export const presenceKey = (userId: string) => `${PRESENCE_KEY_PREFIX}${userId}`

export async function writePresence(kernel: Kernel, userId: string, status: PresenceStatus): Promise<void> {
  if (!kernel.redis) return
  if (status === 'offline') {
    await kernel.redis.del(presenceKey(userId))
    return
  }
  await kernel.redis.set(
    presenceKey(userId),
    JSON.stringify({ status, at: Date.now() }),
    'EX',
    PRESENCE_TTL_SECONDS,
  )
}

export async function readPresence(kernel: Kernel, userIds: string[]): Promise<PresenceEntry[]> {
  const ids = [...new Set(userIds)]
  if (!ids.length) return []
  if (!kernel.redis) return ids.map((userId) => ({ userId, status: 'offline' as const, lastSeen: null }))
  const values = await kernel.redis.mget(ids.map(presenceKey))
  return ids.map((userId, i) => {
    const raw = values[i]
    if (!raw) return { userId, status: 'offline' as const, lastSeen: null }
    try {
      const v = JSON.parse(raw) as { status?: PresenceStatus; at?: number }
      return { userId, status: v.status ?? 'online', lastSeen: v.at ?? null }
    } catch {
      return { userId, status: 'online' as const, lastSeen: null }
    }
  })
}
