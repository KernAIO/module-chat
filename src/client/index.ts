/**
 * The chat module's client half.
 *
 * Everything here is isomorphic: the API client, the conversation store, message rendering and the
 * module's own message catalogue. The Svelte components that draw a conversation live in the
 * application, which owns the design system — the same split the tracker uses. A host imports this,
 * hands the store an API client and a realtime connection, and renders whatever it likes on top.
 */

export type {
  Channel,
  ChannelSection,
  ChannelView,
  ChatContract,
  Message,
  MessageWithChannel,
  RichDoc,
  ThreadView,
} from '../contract/index.js'
export { type ChatApi, createChatClient } from './api.js'
export {
  type ChatMessageKey,
  chatMessageBundles,
  en as chatMessagesEn,
  registerChatMessages,
  setChatLocale,
  t as chatText,
} from './i18n.js'
export {
  avatarColorIndex,
  dayKey,
  dayLabel,
  initials,
  renderDocToHtml,
  timeOf,
} from './render.js'
export {
  ChatStore,
  type ChatStoreOptions,
  type MessageWindow,
  type RealtimeLike,
  type UserLite,
} from './store.svelte.js'
