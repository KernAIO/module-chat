import type { ChannelView } from '../contract/index.js'
import { t } from './i18n.js'

/**
 * How a conversation is named and drawn.
 *
 * Kept out of the components so the rules are testable on their own and stated once: the sidebar,
 * the header and the composer placeholder all have to agree about what a conversation is called.
 */

export type ChannelKind = 'channel' | 'private' | 'dm' | 'group' | 'object'

export function kindOf(c: Pick<ChannelView, 'type'>): ChannelKind {
  switch (c.type) {
    case 'private':
      return 'private'
    case 'dm':
      return 'dm'
    case 'group_dm':
      return 'group'
    case 'object':
      return 'object'
    default:
      return 'channel'
  }
}

/** DESIGN.md 3.7: the kind tile in the conversation header, one colour pair per kind. */
export const KIND_TILE: Record<ChannelKind, { icon: string; bg: string; fg: string }> = {
  channel: { icon: 'hash', bg: 'var(--kern-info-tint)', fg: 'var(--kern-info)' },
  private: { icon: 'lock', bg: 'var(--kern-info-tint)', fg: 'var(--kern-info)' },
  dm: { icon: 'user', bg: 'var(--kern-purple-tint)', fg: 'var(--kern-purple)' },
  group: { icon: 'users', bg: 'var(--kern-success-tint)', fg: 'var(--kern-success-group)' },
  object: { icon: 'square-check-big', bg: 'var(--kern-info-tint)', fg: 'var(--kern-info)' },
}

/** What the composer says it is about to send into. */
export function composerTarget(label: string, kind: ChannelKind): string {
  return kind === 'channel' || kind === 'private' ? `#${label}` : label
}

/**
 * "Ines is typing…" — named while it is one or two people, anonymous beyond that. Naming five people
 * is noise, and the row must not change width as they come and go.
 */
export function typingLabel(names: string[]): string | null {
  if (names.length === 0) return null
  if (names.length === 1) return t('typing_one', { name: names[0] as string })
  if (names.length === 2) return t('typing_two', { a: names[0] as string, b: names[1] as string })
  return t('typing_many')
}
