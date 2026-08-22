/**
 * Chat UI strings. The app shell merges these bundles into its Paraglide catalogue via the
 * `messages` field of the client module; inside chat components use `t()` which reads the
 * same bundle (the shell calls `setChatLocale` when the app locale changes).
 */
export const en = {
  'chat.nav': 'Chat',
  'chat.channels': 'Channels',
  'chat.dms': 'Direct messages',
  'chat.favorites': 'Favorites',
  'chat.browse': 'Browse channels',
  'chat.create_channel': 'Create channel',
  'chat.new_dm': 'New direct message',
  'chat.channel_name': 'Channel name',
  'chat.channel_topic': 'Topic',
  'chat.channel_purpose': 'Purpose',
  'chat.public_channel': 'Public — anyone in the workspace can join',
  'chat.private_channel': 'Private — invite only',
  'chat.create': 'Create',
  'chat.cancel': 'Cancel',
  'chat.join': 'Join',
  'chat.joined': 'Joined',
  'chat.leave': 'Leave channel',
  'chat.archived': 'Archived',
  'chat.members': '{count} members',
  'chat.member': '1 member',
  'chat.search': 'Search messages',
  'chat.search_placeholder': 'Search this space',
  'chat.no_results': 'No messages match your search.',
  'chat.message_placeholder': 'Message {channel} — ⏎ to send',
  'chat.reply_placeholder': 'Reply — ⏎ to send',
  'chat.send': 'Send',
  'chat.typing_one': '{name} is typing…',
  'chat.typing_two': '{a} and {b} are typing…',
  'chat.typing_many': 'Several people are typing…',
  'chat.today': 'Today',
  'chat.yesterday': 'Yesterday',
  'chat.new_messages': 'New messages',
  'chat.thread': 'Thread',
  'chat.replies': '{count} replies',
  'chat.reply': '1 reply',
  'chat.view_thread': 'View thread',
  'chat.edited': '(edited)',
  'chat.deleted': 'This message was deleted',
  'chat.pinned': 'Pinned',
  'chat.pin': 'Pin message',
  'chat.unpin': 'Unpin message',
  'chat.edit': 'Edit message',
  'chat.delete': 'Delete message',
  'chat.bookmark': 'Bookmark',
  'chat.remove_bookmark': 'Remove bookmark',
  'chat.add_reaction': 'Add reaction',
  'chat.reply_in_thread': 'Reply in thread',
  'chat.mark_read': 'Mark as read',
  'chat.mute': 'Mute channel',
  'chat.unmute': 'Unmute channel',
  'chat.empty_channel': 'This is the start of the conversation.',
  'chat.empty_sidebar': 'No channels yet — create one or browse public channels.',
  'chat.select_channel': 'Select a channel to start reading.',
  'chat.load_older': 'Load older messages',
  'chat.discussion': 'Discussion',
  'chat.attachment': 'Attachment',
  'chat.attachments': '{count} attachments',
  'chat.system_message': 'System message',
  'chat.open_chat': 'Open chat',
  'chat.close': 'Close',
  'chat.save': 'Save',
  'chat.online': 'Online',
  'chat.away': 'Away',
  'chat.dnd': 'Do not disturb',
  'chat.offline': 'Offline',
  'chat.group_dm': 'Group message',
  'chat.everyone_mention': 'Notify everyone in this channel',
} as const

export type ChatMessageKey = keyof typeof en
type Bundle = Record<ChatMessageKey, string>

const bundles: Record<string, Partial<Bundle>> = { en }
let locale = 'en'

export function registerChatMessages(loc: string, messages: Partial<Bundle>) {
  bundles[loc] = { ...bundles[loc], ...messages }
}
export function setChatLocale(loc: string) {
  locale = loc
}

/** Translate with `{param}` interpolation; falls back to English. */
export function t(key: ChatMessageKey, params?: Record<string, string | number>): string {
  const raw = bundles[locale]?.[key] ?? en[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

/** Bundles in the shape `defineClientModule().messages` expects. */
export const chatMessageBundles = {
  en: async () => en as Record<string, string>,
}
