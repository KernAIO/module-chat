<script lang="ts">
import { IconButton, Skeleton } from '@kernhq/ui'
import { t } from '../i18n.js'
import type { ChatStore } from '../index.js'
import Composer from './Composer.svelte'
import MessageRow from './MessageRow.svelte'

/**
 * A thread, beside the conversation rather than on top of it.
 *
 * The root message is repeated at the top so the panel makes sense on its own — a reply is
 * meaningless without the thing it replies to, and the conversation behind may have scrolled away.
 */

interface Props {
  store: ChatStore
  rootId: string
  channelId: string
  onclose: () => void
}
let { store, rootId, channelId, onclose }: Props = $props()

const thread = $derived(store.threads[rootId])
</script>

<aside class="panel" data-testid="thread-panel">
  <header class="head">
    <h2>{t('thread')}</h2>
    <IconButton
      icon="x"
      label={t('close_thread')}
      size={28}
      variant="ghost"
      strokeWidth={1.8}
      onclick={onclose}
      data-testid="close-thread"
    />
  </header>

  <div class="scroll">
    {#if !thread}
      <div class="loading">
        <Skeleton width="100%" height="14px" />
        <Skeleton width="80%" height="14px" />
      </div>
    {:else}
      <MessageRow {store} message={thread.root} grouped={false} />
      <div class="divider">
        {thread.root.replyCount === 1
          ? t('one_reply')
          : t('replies', { count: thread.root.replyCount })}
      </div>
      {#each thread.replies as reply (reply.id)}
        <MessageRow {store} message={reply} grouped={false} />
      {/each}
    {/if}
  </div>

  <Composer {store} {channelId} threadRootId={rootId} target={t('thread')} autofocus />
</aside>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    width: var(--kern-detail-w, 380px);
    min-width: 0;
    height: 100%;
    border-inline-start: 1px solid var(--kern-border);
    background: var(--kern-surface);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 56px;
    padding-block: 0;
    padding-inline: 24px 12px;
    border-bottom: 1px solid var(--kern-border);
    flex: none;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 500;
    color: var(--kern-ink-900);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 0 8px;
  }
  .divider {
    margin: 16px 24px 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--kern-border-hairline);
    font-size: 12px;
    color: var(--kern-ink-350);
  }
  .loading {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0 24px;
  }
</style>
