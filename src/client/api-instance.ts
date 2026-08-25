import { getHost } from '@kernhq/ui'
import { type ChatApi, createChatClient } from './api.js'
import { createMockChatApi } from './mock.js'

/**
 * The chat API client.
 *
 * Chat runs in its own service because it holds a websocket per client, but its REST surface is
 * reached the same way as any other module's: `/api/chat`, same origin, same session cookie.
 * `PUBLIC_API_MOCK=1` swaps in the in-memory implementation from `./mock`, which satisfies the same
 * contract types, so no view has a second code path for demos and end-to-end tests.
 */
export type { ChatApi }

let cached: ChatApi | null = null

export function getChatApi(): ChatApi {
  if (cached) return cached
  cached = getHost().isMock ? (createMockChatApi() as unknown as ChatApi) : createReal()
  return cached
}

function createReal(): ChatApi {
  return createChatClient({
    // empty base URL keeps requests same-origin: the dev server proxies /api, and in production the
    // reverse proxy routes /api/chat to the chat service, so the session cookie works in both
    baseUrl: getHost().apiBaseUrl,
  })
}

/** Test seam: lets tests install a fake without touching module state elsewhere. */
export function __setChatApi(api: ChatApi | null) {
  cached = api
}
