import type { Kernel } from '@kernhq/kernel'

export interface UserLite {
  id: string
  name: string
  username: string | null
  avatarUrl: string | null
}

/**
 * Small read-through cache over `core.users.getMany` so message fan-out can render names
 * ("Alice mentioned you in #general") without hammering core. Failures degrade to placeholders.
 */
export class UserDirectory {
  private readonly cache = new Map<string, { v: UserLite; exp: number }>()
  constructor(
    private readonly kernel: Kernel,
    private readonly ttlMs = 60_000,
  ) {}

  async getMany(ids: string[]): Promise<Map<string, UserLite>> {
    const out = new Map<string, UserLite>()
    const missing: string[] = []
    const now = Date.now()
    for (const id of new Set(ids)) {
      const hit = this.cache.get(id)
      if (hit && hit.exp > now) out.set(id, hit.v)
      else missing.push(id)
    }
    if (missing.length) {
      try {
        const users = await this.kernel.call<Array<Partial<UserLite> & { id: string }>>(
          'core.users.getMany',
          { userIds: missing, ids: missing },
        )
        for (const u of users ?? []) {
          const v: UserLite = {
            id: u.id,
            name: u.name ?? 'Unknown',
            username: u.username ?? null,
            avatarUrl: u.avatarUrl ?? null,
          }
          this.cache.set(u.id, { v, exp: now + this.ttlMs })
          out.set(u.id, v)
        }
      } catch (err) {
        this.kernel.log.warn({ err: (err as Error).message }, 'core.users.getMany failed; using placeholders')
      }
      for (const id of missing)
        if (!out.has(id)) out.set(id, { id, name: 'Someone', username: null, avatarUrl: null })
    }
    return out
  }

  async get(id: string): Promise<UserLite> {
    return (await this.getMany([id])).get(id)!
  }

  /** active member user ids of a workspace (for @channel in object/public channels without explicit membership, auto-join) */
  async workspaceMemberIds(workspaceId: string): Promise<string[]> {
    try {
      const res = await this.kernel.call<unknown>('core.workspaces.members', { workspaceId, limit: 200 })
      const items: Array<{ userId?: string; id?: string; status?: string; user?: { id: string } }> =
        Array.isArray(res)
          ? res
          : (((res as { items?: unknown[] })?.items as Array<{
              userId?: string
              id?: string
              status?: string
              user?: { id: string }
            }>) ?? [])
      return items
        .filter((m) => !m.status || m.status === 'active')
        .map((m) => m.userId ?? m.user?.id ?? m.id!)
        .filter(Boolean)
    } catch (err) {
      this.kernel.log.warn({ err: (err as Error).message, workspaceId }, 'core.workspaces.members failed')
      return []
    }
  }
}
