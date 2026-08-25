<script lang="ts">
import { Button, EmptyState, IconButton, navigation, SearchBox, Skeleton, session } from '@kernhq/ui'
import { t } from '../i18n.js'
import { canChat } from '../permissions.js'
import { getChatStore } from '../store-instance.svelte.js'
import ConversationList from './ConversationList.svelte'
import NewChannelDialog from './NewChannelDialog.svelte'
import SearchResults from './SearchResults.svelte'

/**
 * Chat's conversations, in the application sidebar (DESIGN.md 2.3).
 *
 * The sidebar belongs to whichever module you are in — that is why the design gives Chat a "Search
 * this space" box and CHANNELS / DIRECT MESSAGES groups there rather than a third column. The
 * transcript in the content area reads the same store, so unread counts and the open conversation
 * stay in step between the two.
 *
 * Searching replaces the conversation list in the same scroll area rather than appearing under it,
 * so the results are where the list was and never below the fold.
 */

const workspaceSlug = $derived(navigation.workspaceSlug)
const workspace = $derived(session.workspaces.find((w) => w.slug === workspaceSlug))
const store = $derived(getChatStore(workspace?.id ?? '', session.user?.id ?? ''))

/**
 * `navigation.search` is a flattened query string, so a key that is absent reads as `undefined`
 * while the list wants `null` for "nothing selected". The two are not interchangeable here: an
 * `undefined` prop falls back to the component's default, which would highlight the first row.
 */
const activeId = $derived(navigation.search.c ?? null)
let search = $state('')
let newChannelOpen = $state(false)

const searching = $derived(search.trim().length > 0)

/**
 * `SearchBox` clears itself — the ✕ button and Escape both write to `value` directly. Binding is
 * therefore the only way to hear about it; passing the value one-way left the results on screen
 * after the box was already empty.
 */
$effect(() => {
  void store?.search(search)
})

$effect(() => {
  if (store && !store.channelsLoaded) void store.loadChannels()
})

function open(channelId: string) {
  void navigation.go(`/${workspaceSlug}/chat?c=${encodeURIComponent(channelId)}`, {
    keepFocus: true,
    noScroll: true,
  })
}

/** Following a search result opens its conversation and points at the message. */
function openHit(channelId: string, messageId: string) {
  void navigation.go(
    `/${workspaceSlug}/chat?c=${encodeURIComponent(channelId)}&msg=${encodeURIComponent(messageId)}`,
    { keepFocus: true, noScroll: true },
  )
}

function clearSearch() {
  search = ''
}
</script>

<div class="chat-sidebar">
  <div class="controls">
    <SearchBox
      bind:value={search}
      placeholder={t('search_placeholder')}
      data-testid="chat-search"
    />
    {#if canChat('createChannel')}
      <IconButton
        icon="plus"
        label={t('new_channel')}
        size={34}
        radius={9}
        variant="outline"
        strokeWidth={1.9}
        onclick={() => (newChannelOpen = true)}
        data-testid="new-channel"
      />
    {/if}
    <IconButton
      icon="hash"
      label={t('browse_channels')}
      size={34}
      radius={9}
      variant="outline"
      onclick={() => navigation.go(`/${workspaceSlug}/chat?browse=1`)}
      data-testid="browse-channels"
    />
  </div>

  <div class="scroll">
    {#if !store || !store.channelsLoaded}
      <div class="loading">
        {#each [0, 1, 2, 3, 4] as i (i)}<Skeleton width="100%" height="28px" radius="7px" />{/each}
      </div>
    {:else if searching}
      <SearchResults {store} query={search} onopen={openHit} onclear={clearSearch} />
    {:else if store.channels.length === 0}
      <div class="empty">
        <EmptyState
          icon="message-circle"
          title={t('no_conversations')}
          description={t('no_conversations_hint')}
        />
        {#if canChat('createChannel')}
          <Button size="sm" icon="plus" onclick={() => (newChannelOpen = true)}>
            {t('new_channel')}
          </Button>
        {/if}
      </div>
    {:else}
      <ConversationList {store} {activeId} onselect={open} />
    {/if}
  </div>
</div>

{#if store}
  <NewChannelDialog bind:open={newChannelOpen} {store} oncreated={open} />
{/if}

<style>
  .chat-sidebar {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  /* DESIGN.md 2.3 control strip: the module owns this row, and every action stays reachable
     whether or not there are conversations yet. */
  .controls {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 12px 4px;
    flex: none;
  }
  .controls :global(.ksb) {
    flex: 1;
    min-width: 0;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .loading {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 12px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 20px 12px;
  }
</style>
