import { session } from '@kernhq/ui'

/**
 * The chat permissions the conversation views gate on.
 *
 * These are the keys the module's contract declares. The server checks them again on every call —
 * this is only so the interface does not offer something that would be refused. Anything a person
 * may never do is hidden; anything they cannot do *right now* stays visible and disabled with a
 * reason.
 */
export const CHAT_PERMISSIONS = {
  view: 'chat.channel.view',
  createChannel: 'chat.channel.create',
  manageChannel: 'chat.channel.manage',
  deleteChannel: 'chat.channel.delete',
  post: 'chat.message.post',
  editAny: 'chat.message.edit_any',
  deleteAny: 'chat.message.delete_any',
  pin: 'chat.message.pin',
  dm: 'chat.dm.create',
} as const

export type ChatPermission = keyof typeof CHAT_PERMISSIONS

export function canChat(permission: ChatPermission): boolean {
  return session.can(CHAT_PERMISSIONS[permission])
}
