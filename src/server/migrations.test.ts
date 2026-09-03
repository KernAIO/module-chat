import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TENANT_TABLES } from './schema.js'

/**
 * The migration folder, applied to a database created from nothing — and then applied again.
 *
 * `kernel.start()` proves the folder *applies*. It does not prove the folder is **replayable**, and
 * that is the property that takes a host service down: the kernel migrates every module at boot, so
 * a migration that throws does not degrade its own feature, it stops the `chat` service binding its
 * port — and with it the realtime gateway every other module uses. A regenerated
 * `migrations/meta/_journal.json` is enough to cause a replay, because every entry gets a `when`
 * newer than the rows already in `mod_chat.__migrations`.
 *
 * Three things here are deliberate, and each is a way this test could have been vacuously green:
 *
 * 1. **A scratch database, created here.** A database somebody has already migrated proves nothing.
 * 2. **Every statement is executed separately and every failure is collected**, so the report says
 *    how much of the folder is unguarded rather than naming the first statement that is.
 * 3. **Policies are asserted as `(tablename, policyname)` pairs, not as a count per table** — a
 *    duplicate pair is exactly what a replay produces.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(HERE, '../../migrations')

const BASE_URL = process.env.DATABASE_URL ?? 'postgres://kern:kern@localhost:5432/kern'
const DB_NAME = `kern_chat_replay_${Date.now().toString(36)}`

let admin: pg.Client
let db: pg.Client

/** The folder in the order the kernel applies it — by filename, which is why they are numbered. */
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/**
 * Apply one file statement by statement, returning every failure rather than the first.
 *
 * `--> statement-breakpoint` is drizzle's separator. Splitting on it is also why nothing in this
 * folder may use a dollar-quoted body: a breakpoint inside `do $$ … end $$` cuts the function in
 * half, and the error is `unterminated dollar-quoted string`, which does not sound like what it is.
 */
async function apply(file: string): Promise<Array<{ statement: string; error: string }>> {
  const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
  const failures: Array<{ statement: string; error: string }> = []
  for (const raw of sql.split('--> statement-breakpoint')) {
    const statement = raw.trim()
    if (!statement || statement.split('\n').every((l) => l.trim().startsWith('--'))) continue
    try {
      await db.query(statement)
    } catch (err) {
      failures.push({
        statement: statement.slice(0, 120).replace(/\s+/g, ' '),
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return failures
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: BASE_URL })
  await admin.connect()
  await admin.query(`create database "${DB_NAME}"`)
  const url = new URL(BASE_URL)
  url.pathname = `/${DB_NAME}`
  db = new pg.Client({ connectionString: url.toString() })
  await db.connect()
}, 120_000)

afterAll(async () => {
  await db?.end().catch(() => undefined)
  await admin?.query(`drop database if exists "${DB_NAME}" with (force)`).catch(() => undefined)
  await admin?.end().catch(() => undefined)
})

describe('the migration folder', () => {
  it('applies to a database created from nothing', async () => {
    for (const file of migrationFiles()) {
      expect(await apply(file), `${file}, first pass`).toEqual([])
    }
  })

  it('applies a second time, because a replay must not take down the host service', async () => {
    for (const file of migrationFiles()) {
      expect(await apply(file), `${file}, replay`).toEqual([])
    }
  })

  it('leaves exactly one of every policy after the replay', async () => {
    const { rows } = await db.query<{ tablename: string; policyname: string }>(
      `select tablename, policyname from pg_policies where schemaname = 'mod_chat'`,
    )
    const seen = rows.map((r) => `${r.tablename}.${r.policyname}`)
    expect([...new Set(seen)].sort(), 'a duplicate pair is what a replay produces').toEqual(seen.sort())
    for (const table of TENANT_TABLES)
      expect(seen, `mod_chat.${table} has its policy`).toContain(`${table}.${table}_ws_isolation`)
  })

  it('secures every table that carries a workspace column, and forces it', async () => {
    /**
     * The invariant the module states at the top of its RLS migration, asked of the catalogue
     * rather than of a list: any table in `mod_chat` with a `workspace_id` column has row-level
     * security enabled **and forced** — without force the table owner, which is the service's own
     * role, bypasses every policy — and at least one policy. A new table that forgets its policy
     * fails here, by name, rather than being simply readable.
     */
    const { rows } = await db.query<{
      relname: string
      rls: boolean
      forced: boolean
      policies: number
    }>(
      `select c.relname,
              c.relrowsecurity as rls,
              c.relforcerowsecurity as forced,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'mod_chat'
          and c.relkind in ('r', 'p')
          and exists (select 1 from pg_attribute a
                       where a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped)
        order by c.relname`,
    )
    expect(rows.length, 'no tenant table found at all — the schema did not build').toBeGreaterThan(0)
    const unsecured = rows.filter((r) => !r.rls || !r.forced || r.policies === 0).map((r) => r.relname)
    expect(unsecured, 'tenant tables without a forced policy').toEqual([])
    expect(rows.map((r) => r.relname).sort()).toEqual([...TENANT_TABLES].sort())
  })
})
