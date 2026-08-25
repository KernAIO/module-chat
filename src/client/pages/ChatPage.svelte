<script lang="ts">
import { EmptyState, navigation, realtime, Skeleton, session } from '@kernhq/ui'
import { untrack } from 'svelte'
import BrowseChannelsDialog from '../components/BrowseChannelsDialog.svelte'
import Composer from '../components/Composer.svelte'
import ConversationHeader from '../components/ConversationHeader.svelte'
import MessageList from '../components/MessageList.svelte'
import PinnedPanel from '../components/PinnedPanel.svelte'
import ThreadPanel from '../components/ThreadPanel.svelte'
import { t } from '../i18n.js'
import { composerTarget, KIND_TILE, kindOf } from '../labels.js'
import { getChatStore } from '../store-instance.svelte.js'

/**
 * The conversation: header, transcript, composer — and a thread beside it when one is open.
 *
 * The list of conversations is not here. It lives in the application sidebar, because the sidebar
 * belongs to whichever module you are in (DESIGN.md 2.3), and both read the same store.
 *
 * Which conversation is open, and which thread, live in the URL: a conversation can be linked to,
 * opened in a second tab, and survives a reload — the same rule the issues view follows.
 */

const workspaceSlug = $derived(navigation.workspaceSlug)
const workspace = $derived(session.workspaces.find((w) => w.slug === workspaceSlug))
const store = $derived(getChatStore(workspace?.id ?? '', session.user?.id ?? ''))

const activeId = $derived(navigation.search.c)
const threadId = $derived(navigation.search.t)
const browseOpen = $derived(navigation.search.browse === '1')
const pinsOpen = $derived(navigation.search.pins === '1')

/** A thread and the pin list share the same side; opening one closes the other. */
const sidePanel = $derived(threadId ? 'thread' : pinsOpen ? 'pins' : null)

const channel = $derived(activeId && store ? store.channel(activeId) : undefined)

// hand every realtime message to the store, which owns the transcript
$effect(() => {
  const s = store
  if (!s) return
  return realtime.tap((msg) => {
    s.handle(msg)
  })
})

/**
 * Open whatever the URL points at, and mark it read once it is on screen.
 *
 * `openChannel` writes the transcript window, and reading that window is what this effect would
 * otherwise depend on — so it re-ran itself every time it worked. That was not merely wasteful: on
 * leaving a channel the store deletes its window, the effect fired again with the old id still in
 * the address bar, and `openChannel` re-fetched and re-added the channel you had just left. It only
 * ever depends on which conversation is named.
 */
$effect(() => {
  const s = store
  const id = activeId
  if (!s || !id) return
  untrack(() => {
    void s.openChannel(id).then(() => s.markRead(id))
  })
})

$effect(() => {
  const s = store
  const id = threadId
  if (!s || !id) return
  untrack(() => {
    void s.openThread(id)
  })
})

/**
 * Tell the shell what this tab is showing.
 *
 * The strip can only name a URL — "Chat" — from the navigation it knows about. Only the page knows
 * the conversation is `# eng-core`, so it says so once the channel is loaded. Nothing depends on the
 * strip existing: with tabs turned off this goes nowhere.
 */
$effect(() => {
  const c = channel
  if (!c || !store) return
  const kind = kindOf(c)
  // no `#` prefix: the tab already carries the kind as its icon, and two hashes read as a typo
  navigation.describe({ label: store.channelLabel(c), icon: KIND_TILE[kind].icon })
})

/**
 * Change the query string without leaving the conversation.
 *
 * Rebuilt from `navigation` rather than from the router's URL object, because a module cannot read
 * `$app/state`. `keepFocus` matters here: opening a thread while somebody is typing must not take
 * the caret out of the composer.
 */
const setParams = (mutate: (params: URLSearchParams) => void) => {
  const params = new URLSearchParams(navigation.search)
  mutate(params)
  const query = params.toString()
  void navigation.go(`${navigation.pathname}${query ? `?${query}` : ''}`, {
    keepFocus: true,
    noScroll: true,
  })
}

const openThread = (messageId: string) =>
  setParams((p) => {
    p.set('t', messageId)
    p.delete('pins')
  })
const showPins = () =>
  setParams((p) => {
    p.set('pins', '1')
    p.delete('t')
  })
const closePins = () => setParams((p) => p.delete('pins'))
const closeThread = () => setParams((p) => p.delete('t'))
const selectChannel = (channelId: string) =>
  setParams((p) => {
    p.set('c', channelId)
    p.delete('t')
  })
</script>

<svelte:head><title>{t('title')} · Kern</title></svelte:head>

<div class="chat" class:with-thread={!!sidePanel && !!channel}>
  <section class="conversation">
    {#if !store}
      <div class="center"><Skeleton width="220px" height="14px" /></div>
    {:else if !channel}
      <!--
        With a conversation open the header's name is the page's heading. With none open there was
        no heading at all, so the screen had nothing naming it — the design has no title bar here on
        purpose, which makes this the one case where the name is for assistive technology only.
      -->
      <h1 class="sr-only">{t('title')}</h1>
      <div class="center">
        <EmptyState
          icon="message-circle"
          title={t('pick_conversation')}
          description={t('pick_conversation_hint')}
        />
      </div>
    {:else}
      <ConversationHeader
        {store}
        {channel}
        onshowpins={showPins}
        pinsOpen={sidePanel === 'pins'}
        onleft={() =>
          setParams((p) => {
            p.delete('c')
            p.delete('t')
            p.delete('pins')
          })}
      />
      <MessageList {store} channelId={channel.id} onreply={openThread} />
      <Composer
        {store}
        channelId={channel.id}
        target={composerTarget(store.channelLabel(channel), kindOf(channel))}
      />
    {/if}
  </section>

  {#if store && channel && sidePanel === 'thread' && threadId}
    <ThreadPanel {store} rootId={threadId} channelId={channel.id} onclose={closeThread} />
  {:else if store && channel && sidePanel === 'pins'}
    <PinnedPanel
      {store}
      channelId={channel.id}
      workspaceId={workspace?.id ?? ''}
      onclose={closePins}
    />
  {/if}
</div>

{#if store}
  <BrowseChannelsDialog
    open={browseOpen}
    {store}
    onopen={selectChannel}
    onclose={() => setParams((p) => p.delete('browse'))}
  />
{/if}

<style>
  .chat {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }
  .chat.with-thread {
    grid-template-columns: minmax(420px, 1fr) auto;
  }
  .conversation {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--kern-surface);
  }
  .center {
    display: grid;
    place-items: center;
    height: 100%;
  }

  /* a thread beside a narrow conversation squeezes both; below this it takes the whole column */
  @media (max-width: 1100px) {
    .chat.with-thread {
      grid-template-columns: minmax(0, 1fr);
    }
    .chat.with-thread .conversation {
      display: none;
    }
  }
</style>
