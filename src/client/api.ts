import type { ChatContract } from '@kernhq/module-chat/contract'
import { createModuleClient, type KernClientOptions } from '@kernhq/sdk'
import type { ContractRouterClient } from '@orpc/contract'

/** Typed oRPC client for `/api/chat` (see `../contract`). */
export type ChatApi = ContractRouterClient<ChatContract>

export function createChatClient(opts: KernClientOptions): ChatApi {
  return createModuleClient<ChatApi>(opts, 'chat')
}
