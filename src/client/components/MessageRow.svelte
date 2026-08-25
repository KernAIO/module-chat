<script lang="ts">
import {
  Avatar,
  Button,
  Dialog,
  DropdownMenu,
  EmojiPicker,
  Icon,
  IconButton,
  type MenuItem,
  messageLocale,
  QUICK_REACTIONS,
  textToDoc,
  toast,
} from '@kernhq/ui'
import { t } from '../i18n.js'
import type { ChatStore, Message } from '../index.js'
import { renderDocToHtml, timeOf } from '../index.js'
import { canChat } from '../permissions.js'
import { attempt } from '../report.js'
import Attachments from './Attachments.svelte'

/**
 * One message.
 *
 * Consecutive messages from the same person within a few minutes are grouped: the avatar and the
 * name appear once and the rest of the run is just text, which is how a conversation reads. The
 * actions (react, reply, pin, edit, delete) appear on hover but are always in the DOM and reachable
 * by keyboard — a hover-only action does not exist for someone who cannot hover.
 */

interface Props {
  store: ChatStore
  message: Message
  /** true when this message continues a run from the same author */
  grouped: boolean
  /** absent inside a thread panel, where every message is already in the thread */
  onreply?: (messageId: string) => void
}
let { store, message, grouped, onreply }: Props = $props()

const author = $derived(message.authorId ? store.users[message.authorId] : undefined)
const mine = $derived(message.authorId === store.userId)
const html = $derived(renderDocToHtml(message.body))
const time = $derived(timeOf(message.createdAt, messageLocale()))

const canEdit = $derived(mine || canChat('editAny'))
const canDelete = $derived(mine || canChat('deleteAny'))

let editing = $state(false)
let draft = $state('')
let saving = $state(false)
let editEl = $state<HTMLTextAreaElement | null>(null)
let confirmDelete = $state(false)
let deleting = $state(false)
let reactionPickerOpen = $state(false)
let reactionTrigger = $state<HTMLButtonElement | null>(null)

/** `userIds` is a branded `UserId[]`; the store holds the plain string, so compare as strings. */
const reactedByMe = (userIds: readonly string[]) => userIds.includes(store.userId)

function startEditing() {
  draft = message.bodyText
  editing = true
  queueMicrotask(() => {
    editEl?.focus()
    // caret at the end, because you are almost always fixing the end of what you wrote
    const end = editEl?.value.length ?? 0
    editEl?.setSelectionRange(end, end)
  })
}

function cancelEditing() {
  editing = false
  draft = ''
}

async function saveEdit() {
  const value = draft.trim()
  if (!value || saving) return
  if (value === message.bodyText) {
    cancelEditing()
    return
  }
  saving = true
  try {
    // an edit keeps whatever mentions the text still spells out; it cannot add new ones, because
    // the edit box has no people list behind it
    await store.editMessage(message.id, textToDoc(value, []))
    editing = false
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('failed'))
  } finally {
    saving = false
  }
}

async function remove() {
  deleting = true
  try {
    await store.deleteMessage(message.channelId, message.id)
    confirmDelete = false
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('failed'))
  } finally {
    deleting = false
  }
}

function copyLink() {
  const url = new URL(window.location.href)
  url.searchParams.set('c', message.channelId)
  url.searchParams.set('msg', message.id)
  void navigator.clipboard
    .writeText(url.toString())
    .then(() => toast.success(t('link_copied')))
    .catch(() => toast.error(t('link_copy_failed')))
}

const actions = $derived<MenuItem[]>([
  ...(onreply
    ? [
        {
          id: 'reply',
          label: t('reply'),
          icon: 'message-square-text',
          onSelect: () => onreply?.(message.id),
        } as MenuItem,
      ]
    : []),
  {
    id: 'pin',
    label: message.pinned ? t('unpin') : t('pin'),
    icon: 'bookmark',
    disabled: !canChat('pin'),
    hint: canChat('pin') ? undefined : t('pin_denied'),
    onSelect: () => attempt(() => store.togglePin(message.id, message.channelId, !message.pinned)),
  },
  { id: 'copy', label: t('copy_link'), icon: 'link', onSelect: copyLink },
  ...(canEdit ? [{ id: 'edit', label: t('edit'), icon: 'pencil', onSelect: startEditing } as MenuItem] : []),
  ...(canDelete
    ? [
        { type: 'separator' } as MenuItem,
        {
          id: 'delete',
          label: t('delete'),
          icon: 'trash-2',
          danger: true,
          onSelect: () => (confirmDelete = true),
        } as MenuItem,
      ]
    : []),
])
</script>

<article class="msg" class:grouped data-testid="message" data-message-id={message.id}>
  <div class="gutter">
    {#if !grouped}
      <Avatar name={author?.name ?? '?'} id={author?.id} src={author?.avatarUrl} size={36} />
    {:else}
      <span class="hovertime">{time}</span>
    {/if}
  </div>

  <div class="body">
    {#if !grouped}
      <div class="meta">
        <span class="author">{author?.name ?? '…'}</span>
        <time datetime={message.createdAt}>{time}</time>
        {#if message.editedAt}<span class="edited">({t('edited')})</span>{/if}
        {#if message.pinned}
          <span class="pinned"><Icon name="bookmark" size={12} strokeWidth={1.7} /> {t('pinned')}</span>
        {/if}
      </div>
    {/if}

    {#if message.deletedAt}
      <p class="deleted">{t('deleted')}</p>
    {:else if editing}
      <div class="editor">
        <textarea
          bind:this={editEl}
          bind:value={draft}
          rows="2"
          aria-label={t('edit')}
          data-testid="edit-input"
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault()
              void saveEdit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              cancelEditing()
            }
          }}
        ></textarea>
        <div class="editor-actions">
          <Button variant="secondary" size="xs" onclick={cancelEditing}>{t('cancel')}</Button>
          <Button
            size="xs"
            loading={saving}
            disabled={!draft.trim()}
            onclick={saveEdit}
            data-testid="save-edit"
          >
            {t('save')}
          </Button>
          <span class="hint">{t('edit_hint')}</span>
        </div>
      </div>
    {:else}
      <!-- the store renders the document to sanitised HTML; it never interpolates raw input -->
      <div class="text">{@html html}</div>
    {/if}

    {#if message.attachments.length && !editing}
      <Attachments ids={message.attachments} />
    {/if}

    {#if message.reactions.length && !editing}
      <div class="reactions">
        {#each message.reactions as r (r.emoji)}
          <button
            type="button"
            class="chip"
            class:mine={reactedByMe(r.userIds)}
            onclick={() => attempt(() => store.toggleReaction(message.id, message.channelId, r.emoji))}
          >
            <span aria-hidden="true">{r.emoji}</span>
            <span class="count">{r.count}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if message.replyCount > 0 && onreply}
      <button type="button" class="thread" onclick={() => onreply?.(message.id)} data-testid="open-thread">
        <Icon name="message-square-text" size={13} strokeWidth={1.7} />
        {message.replyCount === 1 ? t('one_reply') : t('replies', { count: message.replyCount })}
      </button>
    {/if}
  </div>

  {#if !message.deletedAt && !editing}
    <div class="actions">
      {#each QUICK_REACTIONS as emoji (emoji)}
        <button
          type="button"
          class="quick"
          title={t('react')}
          aria-label={`${t('react')} ${emoji}`}
          onclick={() => attempt(() => store.toggleReaction(message.id, message.channelId, emoji))}
        >
          <span aria-hidden="true">{emoji}</span>
        </button>
      {/each}
      <div class="picker-anchor">
        <IconButton
          bind:ref={reactionTrigger}
          icon="smile"
          label={t('react_other')}
          size={26}
          variant="ghost"
          active={reactionPickerOpen}
          onclick={() => (reactionPickerOpen = !reactionPickerOpen)}
          data-testid="react-more"
        />
        {#if reactionPickerOpen}
          <EmojiPicker
            align="end"
            trigger={reactionTrigger}
            onpick={(emoji) => {
              reactionPickerOpen = false
              attempt(() => store.toggleReaction(message.id, message.channelId, emoji))
            }}
            onclose={() => (reactionPickerOpen = false)}
          />
        {/if}
      </div>

      {#if onreply}
        <IconButton
          icon="message-square-text"
          label={t('reply')}
          size={26}
          variant="ghost"
          onclick={() => onreply?.(message.id)}
        />
      {/if}

      <DropdownMenu items={actions}>
        {#snippet trigger(props)}
          <IconButton
            icon="ellipsis"
            label={t('message_actions')}
            size={26}
            variant="ghost"
            {...props}
          />
        {/snippet}
      </DropdownMenu>
    </div>
  {/if}
</article>

<Dialog bind:open={confirmDelete} title={t('delete')} initialFocus={false}>
  <p class="confirm">{t('delete_confirm')}</p>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => (confirmDelete = false)}>{t('cancel')}</Button>
    <Button variant="danger" loading={deleting} onclick={remove} data-testid="confirm-delete">
      {t('delete')}
    </Button>
  {/snippet}
</Dialog>

<style>
  .msg {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    gap: 12px;
    padding: 0 24px;
    position: relative;
  }
  .msg {
    margin-top: 18px;
  }
  /* a message continuing a run sits close to the one above it */
  .msg.grouped {
    margin-top: 4px;
  }
  .gutter {
    display: flex;
    justify-content: center;
  }
  .hovertime {
    font-size: 11px;
    color: var(--kern-ink-350);
    opacity: 0;
    line-height: 1.55;
  }
  .msg:hover .hovertime {
    opacity: 1;
  }
  .meta {
    display: flex;
    align-items: baseline;
    gap: 9px;
  }
  .author {
    font-size: 14px;
    font-weight: 500;
    color: var(--kern-ink-900);
  }
  time {
    font-size: 12px;
    color: var(--kern-ink-350);
  }
  .edited {
    font-size: 11.5px;
    color: var(--kern-ink-350);
  }
  .pinned {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11.5px;
    color: var(--kern-accent-text);
  }
  .text {
    margin-top: 3px;
    font-size: 14px;
    line-height: 1.55;
    color: var(--kern-ink-700);
    overflow-wrap: anywhere;
  }

  /* The message body is rendered HTML, so these are the renderer's own classes and elements.
     Without them a mention, a link and a code span all read as ordinary text. */
  .text :global(.kern-chat-mention) {
    padding: 0 3px;
    border-radius: var(--kern-r-xs);
    background: var(--kern-accent-tint);
    color: var(--kern-accent-text);
    font-weight: 500;
  }
  .text :global(.kern-chat-link) {
    color: var(--kern-accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .text :global(.kern-chat-code) {
    padding: 1px 4px;
    border-radius: var(--kern-r-xs);
    background: var(--kern-surface-chip);
    font-family: var(--kern-font-mono);
    font-size: 12.5px;
  }
  .text :global(.kern-chat-pre) {
    margin: 6px 0;
    padding: 10px 12px;
    border: 1px solid var(--kern-border-hairline);
    border-radius: var(--kern-r-md2);
    background: var(--kern-surface-chip);
    font-family: var(--kern-font-mono);
    font-size: 12.5px;
    line-height: 1.5;
    overflow-x: auto;
  }
  .text :global(blockquote) {
    margin: 6px 0;
    padding-inline-start: 10px;
    border-inline-start: 2px solid var(--kern-border-strong);
    color: var(--kern-ink-600);
  }
  .text :global(ul),
  .text :global(ol) {
    margin: 4px 0;
    padding-inline-start: 22px;
  }
  .text :global(li) {
    margin: 2px 0;
  }
  .text :global(hr) {
    margin: 10px 0;
    border: 0;
    border-top: 1px solid var(--kern-border-hairline);
  }
  .text :global(p) {
    margin: 0;
  }
  .text :global(p + p) {
    margin-top: 6px;
  }
  .deleted {
    margin: 3px 0 0;
    font-size: 13.5px;
    font-style: italic;
    color: var(--kern-ink-350);
  }
  .reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 7px;
    border: 1px solid var(--kern-border);
    border-radius: var(--kern-r-full);
    background: var(--kern-surface-raised);
    font-size: 12px;
    color: var(--kern-ink-600);
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--kern-border-hover);
  }
  .chip.mine {
    border-color: var(--kern-accent);
    background: var(--kern-accent-tint);
    color: var(--kern-accent-text);
  }
  .count {
    font-weight: 500;
  }
  .thread {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 6px;
    padding: 0;
    border: 0;
    background: none;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--kern-accent-text);
    cursor: pointer;
  }
  .thread:hover {
    text-decoration: underline;
  }
  .actions {
    position: absolute;
    inset-inline-end: 24px;
    top: -10px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--kern-border);
    border-radius: var(--kern-r-md);
    background: var(--kern-surface-raised);
    box-shadow: var(--kern-shadow-popover);
    opacity: 0;
    pointer-events: none;
  }
  .msg:hover .actions,
  .actions:focus-within {
    opacity: 1;
    pointer-events: auto;
  }
  .quick {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: var(--kern-r-sm);
    background: none;
    font-size: 14px;
    cursor: pointer;
  }
  .quick:hover {
    background: var(--kern-surface-hover);
  }
  .picker-anchor {
    position: relative;
    display: flex;
  }
  .editor {
    margin-top: 4px;
  }
  .editor textarea {
    display: block;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--kern-border-strong);
    border-radius: var(--kern-r-md2);
    background: var(--kern-surface-raised);
    resize: vertical;
    font: inherit;
    font-size: 14px;
    line-height: 1.5;
    color: var(--kern-ink-800);
    outline: none;
  }
  /* its own border already shows focus; the global ring would draw a second rectangle */
  .editor textarea:focus-visible {
    box-shadow: none;
    border-color: var(--kern-accent);
  }
  .editor-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }
  .editor-actions .hint {
    font-size: 11.5px;
    color: var(--kern-ink-350);
  }
  .confirm {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--kern-ink-700);
  }
</style>
