import { randomUUID } from 'node:crypto'
import type { Principal } from '@kernhq/contracts'
import { createKernel, type Kernel } from '@kernhq/kernel'
import { eq } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedChatDemo } from './demo.js'
import { chatModule } from './index.js'
import { channels, messages } from './schema.js'
import { chatServices } from './services/index.js'

/**
 * The demo seeder, run against a real Postgres.
 *
 * The case worth proving is the collision: chat makes `#general` and `#random` itself the moment a
 * workspace is created, so the seeder has to post into the channel that is already there rather
 * than making a second one — and its "has this workspace been used?" guard cannot be "are there
 * channels", because there always are.
 */

const BASE_URL = process.env.DATABASE_URL ?? 'postgres://kern:kern@localhost:5432/kern'
const DB_NAME = `kern_chat_demo_${Date.now().toString(36)}`

let kernel: Kernel
let admin: pg.Client

const WS = randomUUID()
const OWNER = randomUUID()

const actor = (): Principal =>
  ({
    kind: 'service',
    userId: OWNER,
    email: null,
    name: 'service:test',
    locale: 'en',
    instanceAdmin: true,
    service: 'test',
    memberships: [],
    permissionVersion: 0,
  }) as unknown as Principal

const seed = () => seedChatDemo({ kernel, workspaceId: WS, actorId: OWNER, actor: actor(), now: new Date() })

beforeAll(async () => {
  admin = new pg.Client({ connectionString: BASE_URL })
  await admin.connect()
  await admin.query(`create database "${DB_NAME}"`)
  const url = new URL(BASE_URL)
  url.pathname = `/${DB_NAME}`

  kernel = await createKernel({
    service: 'chat-demo-test',
    modules: [chatModule],
    role: 'api',
    env: {
      DATABASE_URL: url.toString(),
      KERN_SECRET: 'test-secret-that-is-long-enough-for-kern',
      NODE_ENV: 'test',
      NATS_URL: undefined,
      VALKEY_URL: undefined,
    },
  })
  kernel.broker.register('core', {
    'activity.record': { handler: async () => ({ ok: true }) },
    'notifications.create': { handler: async () => ({ ok: true }) },
    'search.index': { handler: async () => ({ ok: true }) },
    'search.remove': { handler: async () => ({ ok: true }) },
    'settings.getModule': { handler: async () => ({}) },
    'modules.isEnabled': { handler: async () => true },
    'authz.customRolePermissions': { handler: async () => [] },
    'authz.bindings': { handler: async () => [] },
    'workspaces.members': { handler: async () => [] },
    'users.principal': { handler: async () => actor() },
    'users.getMany': {
      handler: async (input: { userIds: string[] }) =>
        input.userIds.map((id) => ({ id, name: 'Demo owner', email: null, avatarUrl: null })),
    },
  })
  await kernel.start()
  // What `core.workspace.created` does in production: #general and #random, before anybody types.
  await chatServices(kernel).channels.bootstrapWorkspace(WS, OWNER)
}, 180_000)

afterAll(async () => {
  await kernel?.stop().catch(() => undefined)
  await admin.query(`drop database if exists "${DB_NAME}" with (force)`).catch(() => undefined)
  await admin.end().catch(() => undefined)
})

describe('the demo seeder', () => {
  it('fills a workspace that already has its bootstrapped channels', async () => {
    const summary = await seed()
    expect(summary.skipped).toBeFalsy()

    const rows = await kernel.database.withWorkspace(WS, async (tx) => ({
      channels: await tx.select().from(channels).where(eq(channels.workspaceId, WS)),
      messages: await tx.select().from(messages).where(eq(messages.workspaceId, WS)),
    }))

    // #general and #random from the bootstrap, plus the five the seeder adds — and exactly one
    // #general, which is what a seeder that created rather than found would have got wrong.
    expect(rows.channels.filter((c) => c.slug === 'general').length).toBe(1)
    expect(rows.channels.map((c) => c.slug).sort()).toEqual([
      'design',
      'engineering',
      'general',
      'incidents',
      'product',
      'random',
      'support',
    ])

    const userMessages = rows.messages.filter((m) => m.kind === 'user')
    expect(userMessages.length).toBe(summary.created?.messages)
    expect(userMessages.length).toBeGreaterThan(15)
    // The thread in #engineering: three replies hanging off one root.
    expect(userMessages.filter((m) => m.threadRootId).length).toBe(3)
    // Somebody wrote in #general, which is the channel the bootstrap made and the seeder found.
    const general = rows.channels.find((c) => c.slug === 'general')!
    expect(userMessages.filter((m) => m.channelId === general.id).length).toBe(4)
  })

  it('leaves a workspace somebody has already written in alone', async () => {
    const before = await kernel.database.withWorkspace(WS, (tx) =>
      tx.select().from(messages).where(eq(messages.workspaceId, WS)),
    )
    expect((await seed()).skipped).toBe(true)
    const after = await kernel.database.withWorkspace(WS, (tx) =>
      tx.select().from(messages).where(eq(messages.workspaceId, WS)),
    )
    expect(after.length).toBe(before.length)
  })
})
