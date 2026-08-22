import type { Kernel } from '@kernhq/kernel'
import { ChannelService } from './channels.js'
import { MessageService } from './messages.js'
import { UserDirectory } from './users.js'

export interface ChatServices {
  users: UserDirectory
  channels: ChannelService
  messages: MessageService
}

const cache = new WeakMap<Kernel, ChatServices>()

/** One service graph per kernel instance (router, procedures and subscriptions share it). */
export function chatServices(kernel: Kernel): ChatServices {
  let s = cache.get(kernel)
  if (!s) {
    const users = new UserDirectory(kernel)
    const channels = new ChannelService(kernel, users)
    const messages = new MessageService(kernel, users, channels)
    channels.messages = messages
    s = { users, channels, messages }
    cache.set(kernel, s)
  }
  return s
}

export * from './db.js'
export { ChannelService, MessageService, UserDirectory }
