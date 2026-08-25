import type { MentionCandidate } from '@kernhq/ui'
import { coreApi, navigation, session } from '@kernhq/ui'
import type { CoreApi } from './core-api.js'

/**
 * The people you can mention.
 *
 * Loaded once per workspace and kept, because the `@` menu has to appear on the keystroke — a list
 * that arrives half a second after you typed `@` is a list you have already given up on. Loading
 * starts the first time somebody types `@`, not on page load, so a workspace you only read costs
 * nothing.
 */

interface PeopleState {
  readonly list: MentionCandidate[]
  readonly loading: boolean
  load(): Promise<void>
}

const cache = new Map<string, { people: MentionCandidate[] }>()

class WorkspacePeople implements PeopleState {
  list = $state<MentionCandidate[]>([])
  loading = $state(false)
  #workspaceId: string
  #started = false

  constructor(workspaceId: string) {
    this.#workspaceId = workspaceId
    const cached = cache.get(workspaceId)
    if (cached) {
      this.list = cached.people
      this.#started = true
    }
  }

  async load() {
    if (this.#started || !this.#workspaceId) return
    this.#started = true
    this.loading = true
    try {
      const res = await coreApi<CoreApi>().workspaces.members.list({
        workspaceId: this.#workspaceId,
        limit: 200,
      })
      this.list = res.items.map((member) => ({
        id: member.userId as string,
        name: member.user.name || member.user.email,
        username: member.user.username,
        avatarUrl: member.user.avatarUrl,
      }))
      cache.set(this.#workspaceId, { people: this.list })
    } catch {
      // an @ menu that cannot load is an empty menu, not an error dialog over the message you are
      // writing; typing the name by hand still sends, it simply does not notify
      this.#started = false
    } finally {
      this.loading = false
    }
  }
}

const instances = new Map<string, WorkspacePeople>()

/** The people of the workspace in the address bar. */
export function workspacePeople(): PeopleState {
  const slug = navigation.workspaceSlug
  const workspaceId = session.workspaces.find((w) => w.slug === slug)?.id ?? ''
  let instance = instances.get(workspaceId)
  if (!instance) {
    instance = new WorkspacePeople(workspaceId)
    instances.set(workspaceId, instance)
  }
  return instance
}

/** Test seam, and how signing out drops the directory. */
export function __clearWorkspacePeople() {
  instances.clear()
  cache.clear()
}
