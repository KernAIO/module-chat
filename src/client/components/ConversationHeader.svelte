<script lang="ts">
import { AvatarStack, Button, Dialog, DropdownMenu, Icon, IconButton, toast } from '@kernhq/ui'
import { t } from '../i18n.js'
import type { ChannelView, ChatStore } from '../index.js'
import { KIND_TILE, kindOf } from '../labels.js'
import { canChat } from '../permissions.js'
import { attempt } from '../report.js'

/**
 * Who you are talking to, and what you can do about it.
 *
 * Every action a conversation supports is reachable from here — starring, muting, pinned messages,
 * leaving — rather than living only in a context menu somebody has to guess at.
 */

interface Props {
  store: ChatStore
  channel: ChannelView
  onshowpins: () => void
  pinsOpen?: boolean
  /**
   * Called after leaving. The conversation is still in the address bar at that point, and the page
   * re-opens whatever the URL names — which puts the channel you just left straight back.
   */
  onleft?: () => void
}
let { store, channel, onshowpins, pinsOpen = false, onleft }: Props = $props()

const kind = $derived(kindOf(channel))
const tile = $derived(KIND_TILE[kind])
const label = $derived(store.channelLabel(channel))
const muted = $derived(channel.membership?.muted ?? false)
const isDm = $derived(kind === 'dm' || kind === 'group')

/**
 * Only people we actually know are in this conversation. Falling back to every cached user showed
 * strangers as members of a channel they had never joined.
 */
const members = $derived(
  channel.dmUserIds.slice(0, 4).map((userId) => ({
    id: userId,
    name: store.users[userId]?.name ?? '…',
    avatarUrl: store.users[userId]?.avatarUrl ?? null,
  })),
)

let confirmLeave = $state(false)
let leaving = $state(false)

async function leave() {
  leaving = true
  try {
    const name = store.channelLabel(channel)
    await store.leaveChannel(channel.id)
    confirmLeave = false
    onleft?.()
    toast.success(t('left', { name }))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('failed'))
  } finally {
    leaving = false
  }
}

const subtitle = $derived(isDm ? (channel.topic ?? '') : t('members_count', { count: channel.memberCount }))
</script>

<header class="head">
  <span class="tile" style="background: {tile.bg}; color: {tile.fg}">
    <Icon name={tile.icon} size={16} strokeWidth={1.7} />
  </span>

  <div class="who">
    <div class="line">
      <h1 class="name" data-testid="conversation-name">{label}</h1>
      {#if subtitle}<span class="kind">{subtitle}</span>{/if}
    </div>
    {#if channel.topic && !isDm}<p class="topic">{channel.topic}</p>{/if}
  </div>

  {#if members.length > 1}
    <AvatarStack people={members} size={24} max={4} />
  {/if}

  <Button
    variant="secondary"
    size="sm"
    icon="video"
    disabled
    title={t('huddle_soon')}
  >
    {t('huddle')}
  </Button>

  <IconButton
    icon="bookmark"
    label={t('pinned_messages')}
    size={32}
    variant="ghost"
    active={pinsOpen}
    onclick={onshowpins}
    data-testid="show-pins"
  />

  <DropdownMenu
    items={[
      {
        id: 'favorite',
        label: channel.favorite ? t('unfavorite') : t('favorite'),
        icon: 'star',
        onSelect: () => attempt(() => store.setFavorite(channel.id, !channel.favorite)),
      },
      {
        id: 'mute',
        label: muted ? t('unmute') : t('mute'),
        icon: muted ? 'bell' : 'bell-off',
        onSelect: () => attempt(() => store.setMuted(channel.id, !muted)),
      },
      ...(isDm
        ? []
        : [
            {
              id: 'leave',
              label: t('leave'),
              icon: 'log-out',
              danger: true,
              onSelect: () => (confirmLeave = true),
            },
          ]),
    ]}
  >
    {#snippet trigger(props)}
      <IconButton icon="ellipsis" label={t('title')} size={32} variant="ghost" {...props} />
    {/snippet}
  </DropdownMenu>
</header>

<Dialog bind:open={confirmLeave} title={t('leave')} initialFocus={false}>
  <p class="confirm">{t('leave_confirm', { name: store.channelLabel(channel) })}</p>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => (confirmLeave = false)}>{t('cancel')}</Button>
    <Button variant="danger" loading={leaving} onclick={leave} data-testid="confirm-leave">
      {t('leave')}
    </Button>
  {/snippet}
</Dialog>

<style>
  .confirm {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--kern-ink-700);
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    height: 56px;
    padding: 0 24px;
    border-bottom: 1px solid var(--kern-border);
    flex: none;
  }
  /* every action keeps its size; only the name and topic give way, and never below a legible width */
  .head > :global(*) {
    align-self: center;
    flex: none;
  }
  .tile {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--kern-r-lg);
    flex: none;
  }
  .who {
    flex: 1 1 auto;
    min-width: 120px;
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .name {
    margin: 0;
    font-size: 15px;
    font-weight: 500;
    color: var(--kern-ink-900);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kind {
    flex: none;
    font-size: 12.5px;
    color: var(--kern-ink-350);
  }
  .topic {
    margin: 1px 0 0;
    font-size: 12.5px;
    color: var(--kern-ink-350);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
