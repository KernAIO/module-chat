<script lang="ts">
import { Icon } from '@kernhq/ui'

/**
 * A conversation, drawn wherever another module refers to one.
 *
 * This is the whole point of presenters: an automation rule, a notification or an issue's activity
 * can mention a channel without knowing anything about chat, and it still renders as a channel.
 */

interface Props {
  id: string
  /** the shell passes what it knows; a bare id still renders rather than showing nothing */
  name?: string | null
  type?: 'public' | 'private' | 'dm' | 'group_dm' | 'object'
  href?: string
}
let { id, name, type = 'public', href }: Props = $props()

const icon = $derived(type === 'private' ? 'lock' : type === 'dm' || type === 'group_dm' ? 'user' : 'hash')
const label = $derived(name ?? id.slice(0, 8))
</script>

<svelte:element this={href ? 'a' : 'span'} {href} class="chip" data-channel-id={id}>
  <Icon name={icon} size={13} strokeWidth={1.7} />
  <span class="name">{label}</span>
</svelte:element>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    padding-block: 1px;
    padding-inline: 5px 7px;
    border-radius: var(--kern-r-2xl);
    background: var(--kern-surface-chip);
    color: var(--kern-ink-700);
    font-size: 12.5px;
    text-decoration: none;
    vertical-align: baseline;
  }
  a.chip:hover {
    background: var(--kern-surface-card-hover);
    color: var(--kern-ink-900);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
