<script lang="ts">
import type { WidgetProps } from '@kernhq/ui'
import { Badge, coreApi, formatCount, Icon, keys, session, toast, WidgetState } from '@kernhq/ui'
import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query'
import { getChatApi } from '../api-instance.js'
import type { CoreApi } from '../core-api.js'
import { t } from '../i18n.js'

/**
 * Conversations with something in them.
 *
 * `channels.unread` gives the counts and `channels.list` gives the names, so the card joins the two
 * rather than walking every channel. Marking one read is the action, because that is what somebody
 * does with a list of unread things they have decided not to open.
 */
let { workspaceId, workspaceSlug, settings, editing }: WidgetProps = $props()

const api = getChatApi()
const client = useQueryClient()
const limit = $derived(Number(settings.limit ?? 6))
const mentionsOnly = $derived(Boolean(settings.mentionsOnly))

const unread = createQuery(() => ({
  queryKey: ['chat', 'unread', workspaceId],
  queryFn: () => api.channels.unread({ workspaceId }),
  enabled: Boolean(workspaceId),
}))

const channels = createQuery(() => ({
  queryKey: ['chat', 'channel', workspaceId],
  queryFn: () => api.channels.list({ workspaceId }),
  enabled: Boolean(workspaceId),
}))

/**
 * A direct message stores no name — it is derived from who is in it. The chat page derives it from
 * its own store, which a widget cannot rely on having loaded, so this resolves the same thing from
 * the workspace's members.
 */
const members = createQuery(() => ({
  queryKey: keys.members(workspaceId),
  queryFn: () => coreApi<CoreApi>().workspaces.members.list({ workspaceId, limit: 100 }),
  enabled: Boolean(workspaceId),
}))

const nameOf = (channel: { type: string; name: string | null; slug: string | null; dmUserIds: string[] }) => {
  if (channel.type !== 'dm' && channel.type !== 'group_dm') return channel.name ?? channel.slug ?? '—'
  const me = session.user?.id
  const others = channel.dmUserIds.filter((u) => u !== me)
  const named = others.map((u) => members.data?.items.find((mem) => mem.userId === u)?.user.name ?? '…')
  return named.length ? named.join(', ') : (session.user?.name ?? '—')
}

const rows = $derived.by(() => {
  const named = new Map((channels.data?.items ?? []).map((c) => [c.id, c]))
  return (unread.data?.channels ?? [])
    .filter((c) => !c.muted)
    .filter((c) => (mentionsOnly ? c.mentionCount > 0 : c.unreadCount > 0))
    .sort((a, b) => b.mentionCount - a.mentionCount || b.unreadCount - a.unreadCount)
    .slice(0, limit)
    .map((c) => ({ ...c, channel: named.get(c.channelId) }))
    .filter((c) => c.channel)
})

const markRead = createMutation(() => ({
  mutationFn: (channelId: string) => api.channels.markRead({ workspaceId, channelId }),
  onSuccess: () => {
    void client.invalidateQueries({ queryKey: ['chat'] })
  },
  onError: (e: unknown) => toast.error(e instanceof Error ? e.message : t('common.error')),
}))
</script>

<WidgetState
  pending={unread.isPending || channels.isPending}
  error={unread.error ?? channels.error}
  empty={rows.length === 0}
  emptyTitle={t('widget_clear')}
  emptyIcon="check"
  onRetry={() => unread.refetch()}
>
  <ul>
    {#each rows as row (row.channelId)}
      <li>
        <a class="row" href="/{workspaceSlug}/chat?channel={row.channelId}">
          <Icon
            name={row.channel?.type === 'public'
              ? 'hash'
              : row.channel?.type === 'private'
                ? 'lock'
                : 'message-circle'}
            size={13}
          />
          <span class="name">{row.channel ? nameOf(row.channel) : '—'}</span>
          {#if row.mentionCount > 0}
            <Badge tone="danger" variant="count">{formatCount(row.mentionCount)}</Badge>
          {:else}
            <Badge tone="grey" variant="count">{formatCount(row.unreadCount)}</Badge>
          {/if}
        </a>
        {#if !editing}
          <span class="act">
            <button
              type="button"
              aria-label={t('widget_mark_read')}
              title={t('widget_mark_read')}
              onclick={() => markRead.mutate(row.channelId)}
            >
              <Icon name="check" size={14} />
            </button>
          </span>
        {/if}
      </li>
    {/each}
  </ul>
</WidgetState>

<style>
  li {
    position: relative;
    border-block-end: 1px solid var(--kern-border-hairline);
  }
  li:last-child {
    border-block-end: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    color: inherit;
  }
  li:hover .row {
    background: var(--kern-surface-hover);
  }
  .name {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    color: var(--kern-ink-900);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .act {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 8px;
    display: none;
    align-items: center;
  }
  li:hover .act,
  .act:focus-within {
    display: flex;
  }
  .act button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--kern-r-sm);
    border: 1px solid var(--kern-border);
    background: var(--kern-surface-raised);
    color: var(--kern-ink-600);
  }
</style>
