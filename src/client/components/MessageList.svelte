<script lang="ts">
import { Button, EmptyState, messageLocale, Skeleton } from '@kernhq/ui'
import { tick } from 'svelte'
import { t } from '../i18n.js'
import type { ChatStore, Message } from '../index.js'
import { dayKey, dayLabel } from '../index.js'
import MessageRow from './MessageRow.svelte'

/**
 * The transcript.
 *
 * Two behaviours matter more than anything else here. It sticks to the bottom while you are at the
 * bottom, and it does *not* when you have scrolled up to read — a conversation that yanks you back
 * down mid-sentence every time somebody types is unusable. And loading older messages keeps the
 * message you were looking at where it was, by restoring the scroll offset from the bottom.
 */

interface Props {
  store: ChatStore
  channelId: string
  onreply: (messageId: string) => void
}
let { store, channelId, onreply }: Props = $props()

let viewport = $state<HTMLElement | null>(null)
let stuckToBottom = $state(true)

const win = $derived(store.window(channelId))
const items = $derived(win.items)

/** Same author, within five minutes, and not across a day boundary. */
const GROUP_WINDOW_MS = 5 * 60_000
const isGrouped = (msg: Message, prev: Message | undefined) =>
  !!prev &&
  prev.authorId === msg.authorId &&
  !!msg.authorId &&
  dayKey(prev.createdAt) === dayKey(msg.createdAt) &&
  new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS

const onscroll = () => {
  if (!viewport) return
  const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
  stuckToBottom = distance < 80
}

const scrollToBottom = () => {
  if (viewport) viewport.scrollTop = viewport.scrollHeight
}

async function loadOlder() {
  if (!viewport) return
  const fromBottom = viewport.scrollHeight - viewport.scrollTop
  await store.loadOlder(channelId)
  await tick()
  // keep the reader where they were rather than at a new scroll position
  if (viewport) viewport.scrollTop = viewport.scrollHeight - fromBottom
}

// a new message only pulls the view down when the reader is already at the bottom
$effect(() => {
  const last = items[items.length - 1]?.id
  if (!last) return
  if (stuckToBottom) void tick().then(scrollToBottom)
})

// switching conversation always starts at the newest message
$effect(() => {
  channelId
  stuckToBottom = true
  void tick().then(scrollToBottom)
})
</script>

<div class="scroll" bind:this={viewport} {onscroll} data-testid="message-list">
  {#if win.error}
    <div class="state" data-testid="transcript-error">
      <EmptyState icon="triangle-alert" title={t('transcript_failed')} description={win.error} />
      <Button variant="secondary" size="sm" onclick={() => store.retryChannel(channelId)}>
        {t('retry')}
      </Button>
    </div>
  {:else if win.loading && !items.length}
    <div class="loading">
      {#each [0, 1, 2, 3] as i (i)}
        <div class="skeleton-row">
          <Skeleton width="36px" height="36px" radius="11px" />
          <div class="skeleton-lines">
            <Skeleton width="140px" height="12px" />
            <Skeleton width="70%" height="12px" />
          </div>
        </div>
      {/each}
    </div>
  {:else}
    {#if win.hasMoreBefore}
      <div class="older">
        <Button variant="secondary" size="sm" onclick={loadOlder} loading={win.loading}>
          {t('load_older')}
        </Button>
      </div>
    {/if}

    {#if items.length === 0}
      <div class="state" data-testid="empty-conversation">
        <EmptyState
          icon="message-circle"
          title={t('no_messages')}
          description={t('no_messages_hint')}
        />
      </div>
    {/if}

    <div class="stream">
      {#each items as msg, i (msg.id)}
        {@const prev = items[i - 1]}
        {#if !prev || dayKey(prev.createdAt) !== dayKey(msg.createdAt)}
          <div class="day">
            <span
              >{dayLabel(msg.createdAt, messageLocale(), {
                today: t('today'),
                yesterday: t('yesterday'),
              })}</span
            >
          </div>
        {/if}
        <MessageRow {store} message={msg} grouped={isGrouped(msg, prev)} {onreply} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 0 8px;
  }
  .stream {
    display: flex;
    flex-direction: column;
  }
  /* the row carries its own top margin; the first one in the stream does not need it */
  .stream > :global(.msg:first-child) {
    margin-top: 0;
  }
  .day {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 18px 24px 14px;
    font-size: 12px;
    color: var(--kern-ink-350);
  }
  .day::before,
  .day::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--kern-border-hairline);
  }
  .older {
    display: flex;
    justify-content: center;
    padding: 4px 0 12px;
  }
  .state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 40px 24px;
  }
  .loading {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 0 24px;
  }
  .skeleton-row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 12px;
  }
  .skeleton-lines {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 4px;
  }
</style>
