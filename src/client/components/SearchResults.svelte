<script lang="ts">
import { Avatar, EmptyState, Icon, messageLocale, Skeleton } from '@kernhq/ui'
import { t } from '../i18n.js'
import type { ChatStore } from '../index.js'
import { renderDocToHtml, timeOf } from '../index.js'

/**
 * What the search box found.
 *
 * The store has been running searches since the box was built, and nothing ever showed the answer.
 * Selecting a result opens the conversation it belongs to, because a search result you cannot follow
 * is a dead end.
 */

interface Props {
  store: ChatStore
  query: string
  onopen: (channelId: string, messageId: string) => void
  onclear: () => void
}
let { store, query, onopen, onclear }: Props = $props()

const results = $derived(store.searchResults ?? [])
</script>

<div class="results" data-testid="search-results">
  <div class="head">
    <span class="count">
      {store.searching
        ? t('searching')
        : results.length === 1
          ? t('search_result_one')
          : t('search_results', { count: results.length })}
    </span>
    <button type="button" onclick={onclear} data-testid="clear-search">{t('clear_search')}</button>
  </div>

  {#if store.searching && results.length === 0}
    <div class="loading">
      <Skeleton width="100%" height="12px" />
      <Skeleton width="80%" height="12px" />
      <Skeleton width="90%" height="12px" />
    </div>
  {:else if results.length === 0}
    <EmptyState icon="search" title={t('search_empty')} description={query} />
  {:else}
    {#each results as msg (msg.id)}
      {@const author = msg.authorId ? store.users[msg.authorId] : undefined}
      <button
        type="button"
        class="hit"
        data-testid="search-hit"
        onclick={() => onopen(msg.channelId, msg.id)}
      >
        <span class="where">
          <Icon name={msg.channel.type === 'private' ? 'lock' : 'hash'} size={12} strokeWidth={1.7} />
          {msg.channel.name ?? t('direct_messages')}
        </span>
        <span class="who">
          <Avatar name={author?.name ?? '?'} id={author?.id} src={author?.avatarUrl} size={18} />
          <span class="name">{author?.name ?? '…'}</span>
          <time datetime={msg.createdAt}>{timeOf(msg.createdAt, messageLocale())}</time>
        </span>
        <span class="text">{@html renderDocToHtml(msg.body)}</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .results {
    padding: 4px 8px 12px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 6px 8px;
  }
  .count {
    font-size: 11.5px;
    color: var(--kern-ink-350);
  }
  .head button {
    border: 0;
    background: none;
    font-size: 11.5px;
    color: var(--kern-accent-text);
    cursor: pointer;
  }
  .loading {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 6px;
  }
  .hit {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 8px;
    border: 0;
    border-radius: var(--kern-r-md2);
    background: none;
    text-align: start;
    cursor: pointer;
  }
  .hit:hover {
    background: var(--kern-surface-hover);
  }
  .where {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11.5px;
    color: var(--kern-ink-350);
  }
  .who {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .name {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--kern-ink-900);
  }
  time {
    font-size: 11px;
    color: var(--kern-ink-350);
  }
  .text {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--kern-ink-600);
  }
  .text :global(p) {
    margin: 0;
  }
</style>
