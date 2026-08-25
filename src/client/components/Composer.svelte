<script lang="ts">
import {
  EmojiPicker,
  IconButton,
  literalFor,
  MediaRecording,
  type MentionCandidate,
  MentionMenu,
  mentionQueryAt,
  navigation,
  type PickedMention,
  type RecorderKind,
  rankCandidates,
  session,
  textToDoc,
  toast,
  uploadFile,
} from '@kernhq/ui'
import { t } from '../i18n.js'
import type { ChatStore } from '../index.js'
import { typingLabel } from '../labels.js'
import { workspacePeople } from '../people.svelte.js'
import { canChat } from '../permissions.js'
import AttachmentTray from './AttachmentTray.svelte'
import RecorderBar from './RecorderBar.svelte'

/**
 * Writing a message.
 *
 * Enter sends and Shift+Enter breaks the line, which is what everyone expects from a chat box. The
 * draft survives switching conversation and coming back — losing what you typed because you looked
 * at something else is the kind of small betrayal that makes people distrust an application.
 *
 * A failed send puts the text back in the box rather than swallowing it.
 *
 * Typing `@` opens the people list. Picking somebody inserts their handle *and records who they
 * are*, so the message carries a real mention and their inbox lights up — see `../mentions.ts`.
 */

interface Props {
  store: ChatStore
  channelId: string
  /** placeholder target, e.g. "#eng-core" */
  target: string
  threadRootId?: string
  autofocus?: boolean
}
let { store, channelId, target, threadRootId, autofocus = false }: Props = $props()

/** drafts per conversation (and per thread), so switching away does not discard them */
const drafts = new Map<string, { text: string; picked: PickedMention[] }>()
const draftKey = $derived(threadRootId ? `${channelId}:${threadRootId}` : channelId)

let text = $state('')
let picked = $state<PickedMention[]>([])
let sending = $state(false)
let el = $state<HTMLTextAreaElement | null>(null)
let emojiOpen = $state(false)
let emojiTrigger = $state<HTMLButtonElement | null>(null)
let fileInput = $state<HTMLInputElement | null>(null)

/** files already uploaded and waiting to go with the next message */
let attached = $state<Array<{ id: string; name: string; mimeType: string }>>([])
let uploading = $state(0)

const recorder = new MediaRecording()
let recordingKind = $state<RecorderKind>('audio')
let sendingRecording = $state(false)
const recordingOpen = $derived(recorder.state !== 'idle')

const workspaceId = $derived(session.workspaces.find((w) => w.slug === navigation.workspaceSlug)?.id ?? '')

/** Largest single upload core accepts by default; the server rejects anything bigger. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

async function attachBlob(blob: Blob, name: string, mimeType?: string) {
  if (blob.size > MAX_UPLOAD_BYTES) {
    toast.error(t('attachment_too_large', { name, limit: 100 }))
    return null
  }
  uploading += 1
  try {
    const file = await uploadFile({ workspaceId, file: blob, name, mimeType })
    attached = [...attached, { id: file.id, name: file.name, mimeType: file.mimeType }]
    return file
  } catch (error) {
    toast.error(error instanceof Error && error.message ? error.message : t('attach_failed', { name }))
    return null
  } finally {
    uploading -= 1
  }
}

async function onFilesPicked(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  for (const file of Array.from(input.files ?? [])) await attachBlob(file, file.name, file.type)
  input.value = ''
}

function startRecording(kind: RecorderKind) {
  recordingKind = kind
  void recorder.start(kind)
}

async function sendRecording() {
  const result = recorder.result
  if (!result) return
  sendingRecording = true
  try {
    const file = await attachBlob(result.blob, result.suggestedName, result.mimeType)
    if (!file) return
    await store.post(channelId, textToDoc(text.trim(), picked), {
      threadRootId,
      attachments: [file.id],
    })
    text = ''
    picked = []
    attached = attached.filter((a) => a.id !== file.id)
    drafts.delete(draftKey)
    recorder.discard()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('failed'))
  } finally {
    sendingRecording = false
  }
}

// the open @ menu, if any
let mentionStart = $state<number | null>(null)
let mentionQuery = $state('')
let mentionActive = $state(0)

const allowed = $derived(canChat('post'))

/**
 * Typing indicators expire on a timer rather than an event — the store filters by how long ago the
 * signal arrived. Nothing re-renders when time passes, so without this tick "Ines is typing…" stays
 * on screen forever after she stops.
 */
let clock = $state(0)
$effect(() => {
  const id = setInterval(() => (clock = Date.now()), 1000)
  return () => clearInterval(id)
})
const typing = $derived.by(() => {
  clock
  return typingLabel(store.typingNames(channelId))
})
const people = workspacePeople()

const candidates = $derived(mentionStart === null ? [] : rankCandidates(people.list, mentionQuery))
const mentionOpen = $derived(mentionStart !== null && (people.loading || candidates.length > 0))

// restore the draft when the conversation (or thread) changes
$effect(() => {
  const draft = drafts.get(draftKey)
  text = draft?.text ?? ''
  picked = draft?.picked ?? []
})

$effect(() => {
  drafts.set(draftKey, { text, picked })
})

$effect(() => {
  if (autofocus && el) el.focus()
})

const grow = () => {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
}

/** Look at where the caret is and decide whether the people list should be open. */
function syncMentionMenu() {
  if (!el) return
  const found = mentionQueryAt(text, el.selectionStart ?? 0)
  if (!found) {
    mentionStart = null
    return
  }
  if (found.start !== mentionStart) mentionActive = 0
  mentionStart = found.start
  mentionQuery = found.query
  void people.load()
}

function closeMentionMenu() {
  mentionStart = null
  mentionQuery = ''
  mentionActive = 0
}

/** Replace the `@…` being typed with this person's handle, and remember who they are. */
function pick(person: MentionCandidate) {
  if (!el || mentionStart === null) return
  const literal = literalFor(person)
  const caret = el.selectionStart ?? text.length
  const before = text.slice(0, mentionStart)
  const after = text.slice(caret)
  text = `${before}${literal} ${after}`
  if (!picked.some((p) => p.userId === person.id && p.literal === literal))
    picked = [...picked, { literal, userId: person.id, label: person.name }]

  const caretAfter = before.length + literal.length + 1
  closeMentionMenu()
  queueMicrotask(() => {
    el?.focus()
    el?.setSelectionRange(caretAfter, caretAfter)
    grow()
  })
}

/** Put something at the caret: an emoji, or the `/` that opens the command list. */
function insertAtCaret(fragment: string, opts: { trailingSpace?: boolean } = {}) {
  if (!el) return
  const start = el.selectionStart ?? text.length
  const end = el.selectionEnd ?? start
  const addition = opts.trailingSpace ? `${fragment} ` : fragment
  text = text.slice(0, start) + addition + text.slice(end)
  const caret = start + addition.length
  queueMicrotask(() => {
    el?.focus()
    el?.setSelectionRange(caret, caret)
    grow()
    syncMentionMenu()
  })
}

/**
 * `/leave`, `/topic engineering`, `/shrug` — commands the server already understood and nothing
 * ever sent it, so typing one posted the text of the command instead of running it.
 *
 * Only a line that is nothing but a command counts. A message that happens to begin with a slash
 * and carries on ("/etc/hosts is where it lives") is a message.
 */
const COMMAND = /^\/([a-z][a-z0-9_-]*)(?:[ \t]+([\s\S]*))?$/i

/** Confirmations for the commands this build knows, so a Persian screen does not answer in English. */
const CONFIRMATIONS: Record<string, () => string> = {
  leave: () => t('cmd_left'),
  mute: () => t('cmd_muted'),
  unmute: () => t('cmd_unmuted'),
  topic: () => t('cmd_topic_set'),
}

async function runCommand(command: string, body: string): Promise<boolean> {
  try {
    const res = await store.runCommand(channelId, command, body)
    if (!res.handled) {
      // An unknown command is the client's to explain: it knows what it can offer, and the
      // server's answer is a bare English string.
      toast.error(t('cmd_unknown', { command, known: Object.keys(CONFIRMATIONS).join(', ') }))
      return false
    }
    const say = CONFIRMATIONS[command.toLowerCase()]
    // Anything this build does not have a phrase for falls back to what the server said, which is
    // what keeps this working once commands are pluggable.
    if (say) toast.info(say())
    else if (res.ephemeral) toast.info(res.ephemeral)
    return true
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('failed'))
    return false
  }
}

async function send() {
  const value = text.trim()
  // an attachment on its own is a message; the server allows an empty body when files are present
  if ((!value && attached.length === 0) || sending || !allowed) return

  const command = attached.length === 0 ? COMMAND.exec(value) : null
  if (command) {
    sending = true
    const restore = text
    text = ''
    closeMentionMenu()
    const ok = await runCommand(command[1] as string, (command[2] ?? '').trim())
    // A command that did not run leaves what was typed, the same as a message that did not send.
    if (!ok) text = restore
    else {
      drafts.delete(draftKey)
      queueMicrotask(grow)
    }
    sending = false
    return
  }

  sending = true
  const restoreText = text
  const restorePicked = picked
  text = ''
  picked = []
  closeMentionMenu()
  const restoreAttached = attached
  attached = []
  try {
    await store.post(channelId, textToDoc(value, restorePicked), {
      threadRootId,
      attachments: restoreAttached.map((a) => a.id),
    })
    drafts.delete(draftKey)
    queueMicrotask(grow)
  } catch (error) {
    // never lose what someone wrote, or what they attached
    text = restoreText
    picked = restorePicked
    attached = restoreAttached
    toast.error(error instanceof Error ? error.message : t('failed'))
  } finally {
    sending = false
  }
}

function onkeydown(event: KeyboardEvent) {
  if (mentionOpen) {
    // while the people list is open it owns these keys, so Enter picks instead of sending
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      mentionActive = (mentionActive + 1) % Math.max(1, candidates.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      mentionActive = (mentionActive - 1 + candidates.length) % Math.max(1, candidates.length)
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const person = candidates[mentionActive]
      if (person) {
        event.preventDefault()
        pick(person)
        return
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMentionMenu()
      return
    }
  }

  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void send()
  }
}
</script>

<div class="composer">
  {#if recordingOpen}
    <RecorderBar
      {recorder}
      kind={recordingKind}
      sending={sendingRecording}
      onsend={sendRecording}
      oncancel={() => recorder.discard()}
    />
  {:else}
  <div class="box" class:disabled={!allowed}>
    {#if mentionOpen}
      <MentionMenu
        {candidates}
        active={mentionActive}
        loading={people.loading && candidates.length === 0}
        onpick={pick}
        onhover={(i) => (mentionActive = i)}
      />
    {/if}

    <textarea
      bind:this={el}
      bind:value={text}
      rows="1"
      class="input"
      disabled={!allowed}
      placeholder={allowed ? t('message_placeholder', { channel: target }) : t('cannot_post')}
      aria-label={t('message_placeholder', { channel: target })}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={mentionOpen}
      aria-controls="chat-mention-menu"
      aria-activedescendant={mentionOpen ? `chat-mention-${mentionActive}` : undefined}
      data-testid="composer"
      oninput={() => {
        grow()
        syncMentionMenu()
        store.sendTyping(channelId, threadRootId)
      }}
      onclick={syncMentionMenu}
      onkeyup={(e) => {
        // arrow keys and Home/End move the caret without changing the text
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) syncMentionMenu()
      }}
      onblur={closeMentionMenu}
      {onkeydown}
    ></textarea>

    {#if attached.length || uploading > 0}
      <AttachmentTray
        items={attached}
        {uploading}
        onremove={(id) => (attached = attached.filter((a) => a.id !== id))}
      />
    {/if}

    <div class="tools">
      <div class="emoji-anchor">
        <IconButton
          bind:ref={emojiTrigger}
          icon="smile"
          label={t('emoji')}
          size={26}
          variant="ghost"
          radius={5}
          disabled={!allowed}
          active={emojiOpen}
          onclick={() => (emojiOpen = !emojiOpen)}
          data-testid="emoji-button"
        />
        {#if emojiOpen}
          <EmojiPicker
            trigger={emojiTrigger}
            onpick={(emoji) => {
              emojiOpen = false
              insertAtCaret(emoji)
            }}
            onclose={() => (emojiOpen = false)}
          />
        {/if}
      </div>

      <IconButton
        icon="paperclip"
        label={t('attach')}
        size={26}
        variant="ghost"
        radius={5}
        disabled={!allowed}
        onclick={() => fileInput?.click()}
        data-testid="attach-button"
      />

      <IconButton
        icon="mic"
        label={t('record_voice')}
        size={26}
        variant="ghost"
        radius={5}
        disabled={!allowed || !recorder.supported}
        onclick={() => startRecording('audio')}
        data-testid="record-voice"
      />

      <IconButton
        icon="video"
        label={t('record_video')}
        size={26}
        variant="ghost"
        radius={5}
        disabled={!allowed || !recorder.supported}
        onclick={() => startRecording('video')}
        data-testid="record-video"
      />

      <IconButton
        icon="at-sign"
        label={t('mention')}
        size={26}
        variant="ghost"
        radius={5}
        disabled={!allowed}
        onclick={() => insertAtCaret('@')}
        data-testid="mention-button"
      />

      <IconButton
        icon="slash"
        label={t('slash')}
        size={26}
        variant="ghost"
        radius={5}
        disabled={!allowed}
        onclick={() => insertAtCaret('/')}
      />

      <span class="typing" aria-live="polite">{typing ?? ''}</span>
      {#if !typing && text.length > 0}
        <span class="hint">{t('newline_hint')}</span>
      {/if}

      <IconButton
        icon="arrow-up"
        label={t('send')}
        size={28}
        radius={6}
        variant="primary"
        strokeWidth={2}
        disabled={!allowed || (!text.trim() && attached.length === 0) || sending}
        onclick={send}
        data-testid="send"
      />
    </div>
  </div>

  <input
    bind:this={fileInput}
    type="file"
    multiple
    class="hidden-input"
    aria-hidden="true"
    tabindex="-1"
    onchange={onFilesPicked}
    data-testid="file-input"
  />
  {/if}
</div>

<style>
  .composer {
    padding: 10px 24px 20px;
    flex: none;
  }
  .box {
    position: relative;
    border: 1px solid var(--kern-border);
    border-radius: var(--kern-r-2xl);
    background: var(--kern-surface-raised);
    padding: 10px 12px 8px;
  }
  .box:focus-within {
    border-color: var(--kern-border-strong);
  }
  .box.disabled {
    background: var(--kern-surface-input);
  }
  .input {
    display: block;
    width: 100%;
    border: 0;
    background: none;
    resize: none;
    font: inherit;
    font-size: 14px;
    line-height: 1.5;
    color: var(--kern-ink-800);
    outline: none;
    max-height: 180px;
  }
  .input::placeholder {
    color: var(--kern-ink-350);
  }
  /* The global :focus-visible rule adds a 3px ring to anything focused. The composer already shows
     focus on its outer box, so the field inside drew a second rectangle around the text. */
  .input:focus-visible {
    box-shadow: none;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
  }
  .emoji-anchor {
    position: relative;
    display: flex;
  }
  /* the real control is the paperclip; this only exists to open the file dialog */
  .hidden-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  .typing {
    flex: 1;
    min-width: 0;
    margin-inline-start: 6px;
    font-size: 12.5px;
    color: var(--kern-ink-350);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* the placeholder teaches this while the box is empty; once you are typing it moves here */
  .hint {
    flex: none;
    margin-inline-end: 6px;
    font-size: 11.5px;
    color: var(--kern-ink-280);
    white-space: nowrap;
  }
</style>
