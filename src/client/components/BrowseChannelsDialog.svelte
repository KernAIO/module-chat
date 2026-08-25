<script lang="ts">
import { Button, Dialog, EmptyState, Icon, SearchBox, toast } from '@kernhq/ui'
import { t } from '../i18n.js'
import type { Channel, ChatStore } from '../index.js'

/**
 * Every public channel, including the ones you are not in.
 *
 * A channel you have already joined stays listed and says so, rather than disappearing — vanishing
 * rows make a list feel broken, and the answer to "did that work?" should be visible.
 */

interface Props {
  open?: boolean
  store: ChatStore
  onopen?: (channelId: string) => void
  /** the URL carries whether this is open, so closing has to clear it or it cannot reopen */
  onclose?: () => void
}
let { open = $bindable(false), store, onopen, onclose }: Props = $props()

type Row = Channel & { joined: boolean }

let query = $state('')
let rows = $state<Row[]>([])
let loading = $state(false)
let joining = $state<string | null>(null)
let searchEl = $state<HTMLInputElement | null>(null)

async function load() {
  loading = true
  try {
    rows = (await store.browseChannels(query.trim() || undefined)) as Row[]
  } finally {
    loading = false
  }
}

$effect(() => {
  if (open) void load()
})

async function join(row: Row) {
  joining = row.id
  try {
    await store.joinChannel(row.id)
    toast.success(t('joined', { name: row.name ?? '' }))
    rows = rows.map((r) => (r.id === row.id ? { ...r, joined: true } : r))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('failed'))
  } finally {
    joining = null
  }
}
</script>

<Dialog
  open={open}
  onOpenChange={(next) => {
    if (!next) onclose?.()
  }}
  title={t('browse_channels')}
  description={t('browse_hint')}
  size="lg"
>
  <div class="search">
    <SearchBox
      bind:ref={searchEl}
      value={query}
      placeholder={t('search_placeholder')}
      oninput={(e) => {
        query = (e.currentTarget as HTMLInputElement).value
        void load()
      }}
      data-testid="browse-search"
    />
  </div>

  {#if !loading && rows.length === 0}
    <EmptyState icon="hash" title={t('browse_empty')} />
  {:else}
    <ul class="rows">
      {#each rows as row (row.id)}
        <li>
          <span class="tile"><Icon name={row.type === 'private' ? 'lock' : 'hash'} size={15} strokeWidth={1.7} /></span>
          <span class="text">
            <span class="name">{row.name}</span>
            {#if row.topic}<span class="topic">{row.topic}</span>{/if}
            <span class="count">{t('members_count', { count: row.memberCount })}</span>
          </span>
          {#if row.joined}
            <Button
              variant="secondary"
              size="sm"
              onclick={() => {
                onclose?.()
                onopen?.(row.id)
              }}
            >
              {t('cmd_open')}
            </Button>
          {:else}
            <Button
              size="sm"
              loading={joining === row.id}
              onclick={() => join(row)}
              data-testid="join-channel"
            >
              {t('join')}
            </Button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Dialog>

<style>
  .search {
    margin-bottom: 10px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 46vh;
    overflow-y: auto;
  }
  li {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 9px 4px;
  }
  li + li {
    border-top: 1px solid var(--kern-border-hairline);
  }
  .tile {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--kern-r-lg);
    background: var(--kern-info-tint);
    color: var(--kern-info);
    flex: none;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .name {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--kern-ink-900);
  }
  .topic {
    font-size: 12.5px;
    color: var(--kern-ink-350);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-size: 12px;
    color: var(--kern-ink-350);
  }
</style>
