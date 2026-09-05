import { randomUUID } from 'node:crypto'
import type { Principal } from '@kernhq/contracts'
import { createKernel, type Kernel } from '@kernhq/kernel'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chatModule } from './index.js'
import { type ChatServices, chatServices } from './services/index.js'

/**
 * Who hears about a channel.
 *
 * A socket subscribes to `ws:<workspaceId>` for every workspace it belongs to the moment it
 * authenticates, so `realtime.change(workspaceId, …)` reaches everybody in the workspace. That is
 * right for a public channel and a disclosure for anything else: archiving a private channel used
 * to tell the whole workspace that it exists and that it had just been archived, whether or not the
 * person may open it. The frames are asserted here rather than the service's return value, because
 * the return value was never wrong.
 */

const BASE_URL = process.env.DATABASE_URL ?? 'postgres://kern:kern@localhost:5432/kern'
const DB_NAME = `kern_chat_ann_${Date.now().toString(36)}`

let kernel: Kernel
let svc: ChatServices
let admin: pg.Client

const WORKSPACE = randomUUID()
const ALICE = randomUUID()
const BOB = randomUUID()

const principal = (userId: string): Principal =>
  ({
    kind: 'user',
    userId,
    email: `${userId}@example.test`,
    name: userId.slice(0, 8),
    locale: 'en',
    instanceAdmin: false,
    service: null,
    memberships: [{ workspaceId: WORKSPACE, role: 'admin', roleIds: [], groupIds: [], status: 'active' }],
    permissionVersion: 0,
  }) as Principal

const alice = principal(ALICE)

/** every frame the service published, in order */
const workspaceWide: Array<{ id: string; op: string }> = []
const toUsers: Array<{ userIds: string[]; id: string }> = []

beforeAll(async () => {
  admin = new pg.Client({ connectionString: BASE_URL })
  await admin.connect()
  await admin.query(`create database "${DB_NAME}"`)
  const url = new URL(BASE_URL)
  url.pathname = `/${DB_NAME}`

  kernel = await createKernel({
    service: 'chat-announce-test',
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
    'modules.isEnabled': { handler: async () => true },
    'workspaces.members': { handler: async () => [] },
    'users.byIds': { handler: async () => [] },
    'users.principal': { handler: async (input: { userId: string }) => principal(input.userId) },
    'authz.customRolePermissions': { handler: async () => [] },
    'authz.bindings': { handler: async () => [] },
    'settings.getModule': { handler: async () => ({}) },
  })
  await kernel.start()

  // Nothing is listening on NATS in a test, so the frames are read where they are published.
  kernel.realtime.change = async (_workspaceId, change) => {
    workspaceWide.push({ id: change.id, op: change.op })
  }
  kernel.realtime.toUsers = async (userIds, msg) => {
    const change = (msg as { change?: { id?: string } }).change
    if (change?.id) toUsers.push({ userIds: [...userIds], id: change.id })
  }

  svc = chatServices(kernel)
}, 180_000)

afterAll(async () => {
  await kernel?.stop().catch(() => undefined)
  await admin?.query(`drop database if exists "${DB_NAME}" with (force)`).catch(() => undefined)
  await admin?.end().catch(() => undefined)
}, 60_000)

beforeEach(() => {
  workspaceWide.length = 0
  toUsers.length = 0
})

describe('a private channel', () => {
  it('is not announced to the workspace when it is created', async () => {
    const ch = await svc.channels.create(WORKSPACE, alice, {
      name: `secret-${randomUUID().slice(0, 8)}`,
      type: 'private',
      memberIds: [BOB],
    })
    expect(workspaceWide.map((c) => c.id)).not.toContain(ch.id)
    expect(toUsers.find((f) => f.id === ch.id)?.userIds).toEqual(expect.arrayContaining([ALICE, BOB]))
  })

  it('is not announced to the workspace when it is archived', async () => {
    const ch = await svc.channels.create(WORKSPACE, alice, {
      name: `secret-${randomUUID().slice(0, 8)}`,
      type: 'private',
      memberIds: [BOB],
    })
    workspaceWide.length = 0
    toUsers.length = 0

    await svc.channels.archive(WORKSPACE, alice, ch.id, true)

    expect(workspaceWide).toEqual([])
    // its members still hear it, or an archived channel would sit in their sidebar until a reload
    expect(toUsers.find((f) => f.id === ch.id)?.userIds).toEqual(expect.arrayContaining([ALICE, BOB]))
  })

  it('is not announced to the workspace when it is restored', async () => {
    const ch = await svc.channels.create(WORKSPACE, alice, {
      name: `secret-${randomUUID().slice(0, 8)}`,
      type: 'private',
    })
    await svc.channels.archive(WORKSPACE, alice, ch.id, true)
    workspaceWide.length = 0

    await svc.channels.archive(WORKSPACE, alice, ch.id, false)

    expect(workspaceWide).toEqual([])
  })
})

describe('a public channel', () => {
  it('is announced to the workspace when it is archived', async () => {
    const ch = await svc.channels.create(WORKSPACE, alice, {
      name: `open-${randomUUID().slice(0, 8)}`,
      type: 'public',
    })
    workspaceWide.length = 0

    await svc.channels.archive(WORKSPACE, alice, ch.id, true)

    expect(workspaceWide).toContainEqual({ id: ch.id, op: 'updated' })
  })
})
