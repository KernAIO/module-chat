import type { core } from '@kernhq/contracts'

/**
 * The slice of core's API chat reaches for, named by shape.
 *
 * Chat needs the workspace's members to resolve a mention to a person and to draw an avatar beside
 * a message. Typing the seam structurally keeps the dependency pointing one way: chat does not
 * import core's router type, and core does not know chat exists. Only the fields actually read are
 * named — a wider type here is a promise about core's surface this module has no standing to make.
 */
export interface CoreMember {
  userId: string
  user: { name: string | null; email: string; username?: string | null; avatarUrl?: string | null }
}

/**
 * A stored file, as core describes it.
 *
 * `@kernhq/contracts` is a dependency of this package already and `core.FileObject` is the real
 * type — so this is an alias, not a second declaration. The rest of this file is structural because
 * those shapes belong to core's *router*, which is the thing chat must not depend on.
 */
export type CoreFile = core.FileObject

export interface CoreUser {
  id: string
  name: string | null
  email: string
  username?: string | null
  avatarUrl?: string | null
}

export interface CoreApi {
  users: {
    get(input: { id: string }): Promise<CoreUser>
  }
  files: {
    get(input: { id: string }): Promise<CoreFile>
    downloadUrl(input: {
      id: string
      disposition?: 'inline' | 'attachment'
      thumbnail?: boolean
    }): Promise<{ url: string }>
  }
  workspaces: {
    members: {
      list(input: { workspaceId: string; limit?: number }): Promise<{ items: CoreMember[] }>
    }
  }
}
