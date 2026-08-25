<script lang="ts">
import type { WidgetProps } from '@kernhq/ui'
import { formatCount, StatTile } from '@kernhq/ui'
import { createQuery } from '@tanstack/svelte-query'
import { getChatApi } from '../api-instance.js'
import { t } from '../i18n.js'

let { workspaceId, workspaceSlug }: WidgetProps = $props()

const api = getChatApi()
const query = createQuery(() => ({
  queryKey: ['chat', 'unread', workspaceId],
  queryFn: () => api.channels.unread({ workspaceId }),
  enabled: Boolean(workspaceId),
}))
</script>

<div class="wrap">
  <StatTile
    label={t('widget_unread_title')}
    value={query.isPending ? '—' : formatCount(query.data?.totals.unread ?? 0)}
    href="/{workspaceSlug}/chat"
    size="md"
    class="tile"
  />
</div>

<style>
  .wrap {
    display: grid;
    align-content: center;
    height: 100%;
    padding: 14px 16px;
  }
  .wrap :global(.tile) {
    border: 0;
    background: transparent;
    padding: 0;
  }
</style>
