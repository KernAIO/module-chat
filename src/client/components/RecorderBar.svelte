<script lang="ts">
import { Button, formatDuration, Icon, IconButton, MediaRecording, type RecorderKind } from '@kernhq/ui'
import { t } from '../i18n.js'

/**
 * Recording a voice or video message, in place of the composer.
 *
 * It takes over the composer rather than floating above it, because recording is a mode: while it
 * runs, sending text is not what you are doing. Stopping does not send — it gives you the recording
 * to listen to first, with Send and Discard as two clearly different buttons. Nobody should
 * accidentally broadcast a false start.
 */

interface Props {
  recorder: MediaRecording
  kind: RecorderKind
  sending?: boolean
  onsend: () => void
  oncancel: () => void
}
let { recorder, kind, sending = false, onsend, oncancel }: Props = $props()

let preview = $state<HTMLVideoElement | null>(null)

// show what the camera sees while it records
$effect(() => {
  if (preview && recorder.stream) preview.srcObject = recorder.stream
})

const errorText = $derived.by(() => {
  switch (recorder.error) {
    case 'denied':
      return t('record_denied')
    case 'no-device':
      return kind === 'video' ? t('record_no_camera') : t('record_no_mic')
    case 'in-use':
      return t('record_in_use')
    case 'unsupported':
      return t('record_unsupported')
    default:
      return t('record_failed')
  }
})
</script>

<div class="bar" data-testid="recorder-bar" data-state={recorder.state}>
  {#if recorder.state === 'denied'}
    <Icon name="triangle-alert" size={16} strokeWidth={1.7} />
    <p class="message">{errorText}</p>
    <Button variant="secondary" size="sm" onclick={oncancel}>{t('cancel')}</Button>
  {:else if recorder.state === 'review' && recorder.result}
    <div class="review">
      {#if kind === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={recorder.result.url} controls playsinline data-testid="recording-preview"></video>
      {:else}
        <audio src={recorder.result.url} controls data-testid="recording-preview"></audio>
      {/if}
    </div>
    <span class="time">{formatDuration(recorder.result.durationMs)}</span>
    <Button variant="secondary" size="sm" onclick={oncancel} disabled={sending}>
      {t('discard')}
    </Button>
    <Button size="sm" icon="arrow-up" loading={sending} onclick={onsend} data-testid="send-recording">
      {t('send')}
    </Button>
  {:else if recorder.state === 'recording'}
    {#if kind === 'video'}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={preview} class="live" muted autoplay playsinline></video>
    {:else}
      <span class="pulse" aria-hidden="true"></span>
    {/if}
    <span class="time" aria-live="off">{formatDuration(recorder.elapsedMs)}</span>
    <span class="message">{kind === 'video' ? t('recording_video') : t('recording_voice')}</span>
    <IconButton
      icon="trash-2"
      label={t('discard')}
      size={28}
      variant="ghost"
      onclick={oncancel}
      data-testid="discard-recording"
    />
    <Button size="sm" onclick={() => recorder.stop()} data-testid="stop-recording">
      {t('stop_recording')}
    </Button>
  {:else}
    <span class="pulse asking" aria-hidden="true"></span>
    <p class="message">{t('record_asking')}</p>
    <Button variant="secondary" size="sm" onclick={oncancel}>{t('cancel')}</Button>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--kern-border);
    border-radius: var(--kern-r-2xl);
    background: var(--kern-surface-raised);
  }
  .message {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 13px;
    color: var(--kern-ink-600);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .time {
    font-family: var(--kern-font-mono);
    font-size: 12.5px;
    color: var(--kern-ink-700);
    font-variant-numeric: tabular-nums;
  }
  .pulse {
    width: 10px;
    height: 10px;
    border-radius: var(--kern-r-full);
    background: var(--kern-danger);
    animation: kern-recording 1.2s ease-in-out infinite;
    flex: none;
  }
  .pulse.asking {
    background: var(--kern-ink-350);
    animation: none;
  }
  @keyframes kern-recording {
    50% {
      opacity: 0.25;
    }
  }
  .live {
    width: 96px;
    height: 54px;
    border-radius: var(--kern-r-md);
    background: var(--kern-ink-900);
    object-fit: cover;
    flex: none;
  }
  .review {
    flex: 1;
    min-width: 0;
  }
  .review video {
    width: 100%;
    max-height: 180px;
    border-radius: var(--kern-r-md);
    background: var(--kern-ink-900);
  }
  .review audio {
    width: 100%;
  }
</style>
