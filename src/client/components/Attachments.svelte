<script lang="ts">
import type { core } from '@kernhq/contracts'
import { coreApi, formatDuration, Icon, Spinner } from '@kernhq/ui'
import type { CoreApi, CoreFile } from '../core-api.js'
import { t } from '../i18n.js'

/**
 * What is attached to a message.
 *
 * A message carries file ids and nothing else — no name, no type, no size — so each one has to be
 * looked up before it can be drawn. They are fetched once and cached for the session, because the
 * same file appears in the transcript, in search results and in the pinned panel, and nobody needs
 * three requests for one voice note.
 *
 * A voice note is a player, a video is a video, and anything else is a card you can download.
 */

interface Props {
  ids: readonly string[]
}
let { ids }: Props = $props()

/** file id → the file, or null while it is being fetched */
const cache = new Map<string, core.FileObject>()
const urls = new Map<string, string>()

let files = $state<Array<core.FileObject | null>>([])
let failed = $state(false)

async function urlFor(file: core.FileObject): Promise<string> {
  const cached = urls.get(file.id)
  if (cached) return cached
  const res = await coreApi<CoreApi>().files.downloadUrl({
    id: file.id as never,
    disposition: 'inline',
    thumbnail: false,
  })
  urls.set(file.id, res.url)
  return res.url
}

$effect(() => {
  const wanted = [...ids]
  if (wanted.length === 0) {
    files = []
    return
  }
  failed = false
  files = wanted.map((id) => cache.get(id) ?? null)
  void Promise.all(
    wanted.map(async (id) => {
      if (cache.has(id)) return
      try {
        const file = await coreApi<CoreApi>().files.get({ id: id as never })
        cache.set(id, file)
      } catch {
        failed = true
      }
    }),
  ).then(() => {
    files = wanted.map((id) => cache.get(id) ?? null)
  })
})

const kindOf = (file: core.FileObject) =>
  file.mimeType.startsWith('audio/')
    ? 'audio'
    : file.mimeType.startsWith('video/')
      ? 'video'
      : file.mimeType.startsWith('image/')
        ? 'image'
        : 'file'

const humanSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

{#if ids.length}
  <div class="attachments" data-testid="attachments">
    {#each files as file, i (ids[i])}
      {#if !file}
        <div class="pending"><Spinner size={14} /> <span>{t('attachment_loading')}</span></div>
      {:else}
        {@const kind = kindOf(file)}
        {#await urlFor(file) then url}
          {#if kind === 'audio'}
            <div class="voice" data-testid="attachment-audio">
              <Icon name="mic" size={14} strokeWidth={1.7} />
              <!-- svelte-ignore a11y_media_has_caption -->
              <audio src={url} controls preload="metadata" aria-label={file.name}></audio>
              {#if file.durationMs}<span class="meta">{formatDuration(file.durationMs)}</span>{/if}
            </div>
          {:else if kind === 'video'}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
              src={url}
              controls
              preload="metadata"
              playsinline
              class="video"
              aria-label={file.name}
              data-testid="attachment-video"
            ></video>
          {:else if kind === 'image'}
            <a href={url} target="_blank" rel="noopener noreferrer" class="image">
              <img src={url} alt={file.name} loading="lazy" />
            </a>
          {:else}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              class="card"
              data-testid="attachment-file"
            >
              <Icon name="paperclip" size={15} strokeWidth={1.7} />
              <span class="name">{file.name}</span>
              <span class="meta">{humanSize(file.size)}</span>
            </a>
          {/if}
        {/await}
      {/if}
    {/each}

    {#if failed}
      <p class="failed">{t('attachment_failed')}</p>
    {/if}
  </div>
{/if}

<style>
  .attachments {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    margin-top: 8px;
    max-width: 460px;
  }
  .pending,
  .failed {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 12.5px;
    color: var(--kern-ink-350);
  }
  .voice {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--kern-border);
    border-radius: var(--kern-r-2xl);
    background: var(--kern-surface-raised);
    color: var(--kern-ink-500);
  }
  .voice audio {
    flex: 1;
    min-width: 0;
    height: 32px;
  }
  .video {
    width: 100%;
    max-height: 300px;
    border-radius: var(--kern-r-2xl);
    background: var(--kern-ink-900);
  }
  .image img {
    max-width: 100%;
    max-height: 300px;
    border-radius: var(--kern-r-2xl);
    display: block;
  }
  .card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--kern-border);
    border-radius: var(--kern-r-2xl);
    background: var(--kern-surface-raised);
    color: var(--kern-ink-700);
    text-decoration: none;
    max-width: 100%;
  }
  .card:hover {
    background: var(--kern-surface-card-hover);
  }
  .name {
    flex: 1;
    min-width: 0;
    font-size: 13.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    flex: none;
    font-size: 12px;
    color: var(--kern-ink-350);
    font-variant-numeric: tabular-nums;
  }
</style>
