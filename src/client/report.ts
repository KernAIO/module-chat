import { toast } from '@kernhq/ui'
import { t } from './i18n.js'

/**
 * Run a mutation and say something when it fails.
 *
 * Every action in chat used to be fired with `void store.something()`, which throws the failure on
 * the floor: the reaction does not appear, the channel does not mute, and nothing tells you why.
 * Optimism is fine — silence is not.
 */
export function attempt(work: () => Promise<unknown>, failed: () => string = () => t('failed')) {
  void work().catch((error: unknown) => {
    toast.error(error instanceof Error && error.message ? error.message : failed())
  })
}
