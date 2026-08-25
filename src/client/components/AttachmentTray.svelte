<script lang="ts">
import { Icon, IconButton, Spinner } from '@kernhq/ui'
import { t } from '../i18n.js'

/**
 * Files waiting to go with the next message.
 *
 * They are already uploaded by the time they appear here — the upload starts the moment you choose
 * a file, so pressing send is instant rather than the point at which a long wait begins. Removing
 * one takes it off this message; the uploaded file itself is left alone, because it may already be
 * referenced elsewhere and deleting other people's data to tidy up is not this component's business.
 */

interface Props {
  items: Array<{ id: string; name: string; mimeType: string }>
  uploading: number
  onremove: (id: string) => void
}
let { items, uploading, onremove }: Props = $props()

const iconFor = (mimeType: string) =>
  mimeType.startsWith('audio/')
    ? 'mic'
    : mimeType.startsWith('video/')
      ? 'video'
      : mimeType.startsWith('image/')
        ? 'image'
        : 'paperclip'
</script>

<div class="tray" data-testid="attachment-tray">
  {#each items as item (item.id)}
    <span class="chip" data-testid="pending-attachment">
      <Icon name={iconFor(item.mimeType)} size={13} strokeWidth={1.7} />
      <span class="name">{item.name}</span>
      <IconButton
        icon="x"
        label={t('remove_attachment')}
        size={22}
        variant="ghost"
        strokeWidth={1.8}
        onclick={() => onremove(item.id)}
      />
    </span>
  {/each}

  {#each Array.from({ length: uploading }) as _, i (i)}
    <span class="chip pending">
      <Spinner size={13} />
      <span class="name">{t('attaching', { name: '' })}</span>
    </span>
  {/each}
</div>

<style>
  .tray {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 240px;
    padding-block: 2px;
    padding-inline: 8px 2px;
    border: 1px solid var(--kern-border);
    border-radius: var(--kern-r-full);
    background: var(--kern-surface-chip);
    color: var(--kern-ink-600);
    font-size: 12.5px;
  }
  .chip.pending {
    padding-inline-end: 10px;
    color: var(--kern-ink-350);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
