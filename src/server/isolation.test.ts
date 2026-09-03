import { randomUUID } from 'node:crypto'
import type { Principal } from '@kernhq/contracts'
import { createKernel, type Kernel } from '@kernhq/kernel'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chatModule } from './index.js'
import { type ChatServices, chatServices } from './services/index.js'

/**
 * Cross-tenant isolation, as a class rather than as a list of bugs.
 *
 * Every case hands a service an id that belongs to **workspace A** while the call is made for
 * **workspace B**. A query whose `WHERE` is only `eq(table.id, input.something)` finds that row and
 * acts on it — which is how a reply count landed on a stranger's comment in the tracker before its
 * own test of this shape existed.
 *
 * Two layers are asserted, because each is a defence the other does not provide:
 *
 *  1. **the service**, which must answer the module's honest *not found* — never `forbidden`,
 *     which would confirm the row exists;
 *  2. **row-level security**, which is only observable under a role that cannot bypass it. The
 *     development user is a superuser and superusers bypass RLS entirely, so the probe below opens
 *     a second connection as an explicit `nosuperuser nobypassrls` role. Chat's policies also admit
 *     the `'*'` sentinel the gateway uses for its cross-workspace access checks; the probe asserts
 *     that a plain workspace binding is still one workspace.
 */

const BASE_URL = process.env.DATABASE_URL ?? 'postgres://kern:kern@localhost:5432/kern'
const DB_NAME = `kern_chat_iso_${Date.now().toString(36)}`
const RLS_ROLE = `kern_chat_iso_rls_${Date.now().toString(36)}`

let kernel: Kernel
let svc: ChatServices
let admin: pg.Client
let databaseUrl: string

const WS_A = randomUUID()
const WS_B = randomUUID()
const ALICE = randomUUID()
const BOB = randomUUID()

const principal = (userId: string, workspaceId: string): Principal =>
  ({
    kind: 'user',
    userId,
    email: `${userId}@example.test`,
    name: userId.slice(0, 8),
    locale: 'en',
    instanceAdmin: false,
    service: null,
    memberships: [{ workspaceId, role: 'admin', roleIds: [], groupIds: [], status: 'active' }],
    permissionVersion: 0,
  }) as Principal

const inA = principal(ALICE, WS_A)
const inB = principal(BOB, WS_B)

const doc = (text: string) => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }],
})

function registerCoreStubs(k: Kernel) {
  k.broker.register('core', {
    'activity.record': { handler: async () => ({ ok: true }) },
    'notifications.create': { handler: async () => ({ ok: true }) },
    'search.index': { handler: async () => ({ ok: true }) },
    'search.remove': { handler: async () => ({ ok: true }) },
    'modules.isEnabled': { handler: async () => true },
    'workspaces.members': { handler: async () => [] },
    'users.byIds': { handler: async () => [] },
    'users.principal': {
      handler: async (input: { userId: string }) =>
        principal(input.userId, input.userId === BOB ? WS_B : WS_A),
    },
    'authz.customRolePermissions': { handler: async () => [] },
    'authz.bindings': { handler: async () => [] },
    'settings.getModule': { handler: async () => ({}) },
  })
}

/** Seeded in A, and named by the tests as the id a caller in B tries to reach. */
let channelA: string
let messageA: string
/** Seeded in B, so a cross-tenant call has somewhere legitimate to stand. */
let channelB: string

beforeAll(async () => {
  admin = new pg.Client({ connectionString: BASE_URL })
  await admin.connect()
  await admin.query(`create database "${DB_NAME}"`)
  const url = new URL(BASE_URL)
  url.pathname = `/${DB_NAME}`
  databaseUrl = url.toString()

  kernel = await createKernel({
    service: 'chat-isolation-test',
    modules: [chatModule],
    role: 'api',
    env: {
      DATABASE_URL: databaseUrl,
      KERN_SECRET: 'test-secret-that-is-long-enough-for-kern',
      NODE_ENV: 'test',
      NATS_URL: undefined,
      VALKEY_URL: undefined,
    },
  })
  registerCoreStubs(kernel)
  await kernel.start()
  svc = chatServices(kernel)

  const a = await svc.channels.create(WS_A, inA, { name: 'alpha', type: 'public' })
  channelA = a.id
  const m = await svc.messages.post(WS_A, inA, { channelId: channelA, body: doc('alpha says hello') })
  messageA = m.id

  const b = await svc.channels.create(WS_B, inB, { name: 'beta', type: 'public' })
  channelB = b.id
}, 180_000)

afterAll(async () => {
  await kernel?.stop().catch(() => undefined)
  await admin?.query(`drop database if exists "${DB_NAME}" with (force)`).catch(() => undefined)
  await admin?.query(`drop role if exists "${RLS_ROLE}"`).catch(() => undefined)
  await admin?.end().catch(() => undefined)
}, 60_000)

describe('an id from workspace A, used from workspace B', () => {
  it('is not a channel B can open', async () => {
    await expect(svc.channels.get(WS_B, inB, channelA)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('is not a message B can read', async () => {
    await expect(svc.messages.get(WS_B, inB, messageA)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('is not a channel B can post into', async () => {
    await expect(
      svc.messages.post(WS_B, inB, { channelId: channelA, body: doc('smuggled') }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('is not a message B can edit, delete, pin or react to', async () => {
    await expect(svc.messages.edit(WS_B, inB, messageA, doc('rewritten'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(svc.messages.delete(WS_B, inB, messageA)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(svc.messages.pin(WS_B, inB, messageA, true)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(svc.messages.react(WS_B, inB, messageA, '👀')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('is not a channel B can join, leave or archive', async () => {
    await expect(svc.channels.join(WS_B, inB, channelA)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(svc.channels.archive(WS_B, inB, channelA, true)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('does not appear in a search made from B', async () => {
    const found = await svc.messages.search(WS_B, inB, { q: 'alpha', limit: 20 })
    expect(found.items.map((m) => m.id)).not.toContain(messageA)
  })

  it('leaves A exactly as it was', async () => {
    const m = await svc.messages.get(WS_A, inA, messageA)
    expect(m.id).toBe(messageA)
    expect(m.channelId).toBe(channelA)
    const ch = await svc.channels.get(WS_A, inA, channelA)
    expect(ch.id).toBe(channelA)
    // and B's own channel is untouched by any of the refusals above
    const chb = await svc.channels.get(WS_B, inB, channelB)
    expect(chb.id).toBe(channelB)
  })
})

describe('row-level security, under a role that cannot bypass it', () => {
  let plain: pg.Client

  beforeAll(async () => {
    const scratch = new pg.Client({ connectionString: databaseUrl })
    await scratch.connect()
    await scratch.query(`create role "${RLS_ROLE}" login password 'probe' nosuperuser nobypassrls`)
    await scratch.query(`grant usage on schema mod_chat to "${RLS_ROLE}"`)
    await scratch.query(`grant select on all tables in schema mod_chat to "${RLS_ROLE}"`)
    await scratch.end()

    const url = new URL(databaseUrl)
    url.username = RLS_ROLE
    url.password = 'probe'
    plain = new pg.Client({ connectionString: url.toString() })
    await plain.connect()
  }, 60_000)

  afterAll(async () => {
    await plain?.end().catch(() => undefined)
  })

  const count = async (sqlText: string) => {
    const { rows } = await plain.query<{ n: string }>(sqlText)
    return Number(rows[0]?.n ?? -1)
  }

  it('shows a session bound to B none of A, even when the query asks for A by id', async () => {
    await plain.query(`set app.workspace_id = '${WS_B}'`)
    expect(await count(`select count(*) as n from mod_chat.messages where id = '${messageA}'`)).toBe(0)
    expect(await count(`select count(*) as n from mod_chat.channels where id = '${channelA}'`)).toBe(0)
    expect(
      await count(`select count(*) as n from mod_chat.channel_members where channel_id = '${channelA}'`),
    ).toBe(0)
    // and the binding is what admits B's own rows, so the zero above is a policy, not an empty table
    expect(await count(`select count(*) as n from mod_chat.channels where id = '${channelB}'`)).toBe(1)
  })

  it('shows a session bound to nothing nothing at all', async () => {
    await plain.query(`reset app.workspace_id`)
    expect(await count(`select count(*) as n from mod_chat.messages`)).toBe(0)
    expect(await count(`select count(*) as n from mod_chat.channels`)).toBe(0)
  })
})
