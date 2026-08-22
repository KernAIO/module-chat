import { createModuleClient, type KernClientOptions } from '@kernaio/sdk'
import type { ContractRouterClient } from '@orpc/contract'
import type { ChatContract } from '../contract/index.js'

/** Typed oRPC client for `/api/chat` (see `../contract`). */
export type ChatApi = ContractRouterClient<ChatContract>

export function createChatClient(opts: KernClientOptions): ChatApi {
  return createModuleClient<ChatApi>(opts, 'chat')
}
