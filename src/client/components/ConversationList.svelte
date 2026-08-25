<script lang="ts">
import { Avatar, formatCount, Icon, SectionLabel } from '@kernhq/ui'
import { t } from '../i18n.js'
import type { ChannelView, ChatStore } from '../index.js'
import { kindOf } from '../labels.js'

/**
 * The conversations rail: starred first, then channels, then direct messages.
 *
 * Unread state is the only thing that changes weight here — an unread conversation is bolder and
 * carries its count, a muted one stays quiet even when it has unread messages, because that is what
 * muting means. Everything else is deliberately flat so the eye goes to what is new.
 */

interface Props {
  store: ChatStore
  activeId: string | null
  onselect: (channelId: string) => void
}
let { store, activeId, onselect }: Props = $props()

const sorted = $derived.by(() => {
  const list = [...store.channels]
  return list.sort((a, b) => {
    const at = a.lastMessageAt ?? a.createdAt
    const bt = b.lastMessageAt ?? b.createdAt
    return bt.localeCompare(at)
  })
})

const starred = $derived(sorted.filter((c) => c.favorite))
const channels = $derived(
  sorted.filter((c) => !c.favorite && (c.type === 'public' || c.type === 'private' || c.type === 'object')),
)
const dms = $derived(sorted.filter((c) => !c.favorite && (c.type === 'dm' || c.type === 'group_dm')))

const unreadOf = (c: ChannelView) => c.membership?.unreadCount ?? 0
const mentionsOf = (c: ChannelView) => c.membership?.mentionCount ?? 0
const isMuted = (c: ChannelView) => c.membership?.muted ?? false

/** The other person in a direct message, so the row can show their avatar and presence. */
const otherUser = (c: ChannelView) => {
  const other = c.dmUserIds.find((u) => u !== store.userId) ?? c.dmUserIds[0]
  return other ? store.users[other] : undefined
}
</script>

<div class="list">
    {#snippet group(label: string, items: ChannelView[])}
      {#if items.length}
        <div class="group">
          <SectionLabel {label} />
          {#each items as c (c.id)}
            {@const unread = unreadOf(c)}
            {@const mentions = mentionsOf(c)}
            {@const muted = isMuted(c)}
            {@const dm = c.type === 'dm' || c.type === 'group_dm'}
            <button
              type="button"
              class="row"
              class:active={c.id === activeId}
              class:unread={unread > 0 && !muted}
              class:muted
              aria-current={c.id === activeId ? 'page' : undefined}
              data-testid="conversation-row"
              data-channel-id={c.id}
              onclick={() => onselect(c.id)}
            >
              {#if dm}
                {@const other = otherUser(c)}
                <Avatar
                  name={other?.name ?? '?'}
                  id={other?.id}
                  src={other?.avatarUrl}
                  size={18}
                  presence={other ? (store.presence[other.id] ?? 'offline') : null}
                />
              {:else}
                <Icon name={kindOf(c) === 'private' ? 'lock' : 'hash'} size={15} strokeWidth={1.7} />
              {/if}
              <span class="name">{store.channelLabel(c)}</span>
              {#if mentions > 0 && !muted}
                <span class="badge glow">{formatCount(mentions)}</span>
              {:else if unread > 0 && !muted}
                <span class="badge glow">{formatCount(unread)}</span>
              {:else if unread > 0 && muted}
                <!-- muted still counts, quietly: the point of muting is that it does not shout -->
                <span class="badge">{formatCount(unread)}</span>
              {:else if muted}
                <Icon name="bell-off" size={13} strokeWidth={1.6} class="mute-mark" />
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    {/snippet}

  {@render group(t('starred'), starred)}
  {@render group(t('channels'), channels)}
  {@render group(t('direct_messages'), dms)}
</div>

<style>
  /* DESIGN.md 2.3: nav scroll area `padding: 0 0 14px`, each group `padding: 4px 12px 6px`. */
  .list {
    padding-block: 0 14px;
  }
  .group {
    padding: 4px 12px 6px;
  }

  /* DESIGN.md 2.3 nav item — these are the sidebar's own geometry, not chat's invention. */
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 34px;
    padding-inline: 10px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--kern-ink-650);
    font-size: 13.5px;
    text-align: start;
    cursor: pointer;
  }
  .row:hover {
    background: var(--kern-border);
  }
  .row.active {
    background: var(--kern-ink-900);
    color: var(--kern-surface);
  }
  .row.active :global(svg) {
    color: var(--kern-surface);
  }
  .row.active .name {
    font-weight: 600;
  }
  .row.unread:not(.active) {
    color: var(--kern-ink-900);
    font-weight: 500;
  }
  .row.muted {
    opacity: 0.62;
  }
  .row :global(svg) {
    flex: none;
    color: var(--kern-ink-330);
  }
  .name {
    flex: 1;
    min-width: 0;
    letter-spacing: -0.005em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* DESIGN.md 2.3 badge: the "count" variant, and "glow" when it is unread or a mention. */
  .badge {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 16px;
    min-width: 17px;
    padding: 0 5px;
    line-height: 1;
    border-radius: var(--kern-r-full);
    background: var(--kern-surface-active);
    color: var(--kern-ink-400);
    font-family: var(--kern-font-mono);
    font-size: 10.5px;
    font-weight: 500;
  }
  .badge.glow {
    background: var(--kern-danger);
    color: var(--kern-surface);
  }
  .row.active .badge {
    background: var(--kern-ink-700);
    color: var(--kern-surface);
  }
  .row.active .badge.glow {
    background: var(--kern-danger);
  }
  .row :global(.mute-mark) {
    flex: none;
    color: var(--kern-ink-350);
  }
</style>
