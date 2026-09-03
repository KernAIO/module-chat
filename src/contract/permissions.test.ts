/**
 * The chat permission matrix, blessed rather than assumed.
 *
 * Defaults are declared one permission at a time, which makes the whole picture — which built-in
 * role ends up holding what — impossible to read from any single line. This writes it out in full
 * and compares it against what the module declares, so "a guest can post a message" is something a
 * reviewer reads instead of derives. Rows list the *effective* grants, cascade included: the kernel
 * expands declared `defaultRoles` upward through guest ⊆ member ⊆ admin ⊆ owner, and
 * `permissionMatrixDiff` applies the same expansion.
 *
 * Changing a default is meant to be deliberate: edit `defaultRoles` → this fails naming every row
 * that moved → confirm that is what you meant → update `BLESSED` in the same commit.
 */
import { permissionMatrixDiff } from '@kernhq/testing'
import { describe, expect, it } from 'vitest'
import { chatPermissions } from './index.js'

/** Every built-in role that holds the permission by default, lowest role first. */
const BLESSED: Record<string, readonly string[]> = {
  'chat.channel.view': ['guest', 'member', 'admin', 'owner'],
  'chat.channel.create': ['member', 'admin', 'owner'],
  'chat.channel.manage': ['admin', 'owner'],
  'chat.channel.delete': ['admin', 'owner'],
  'chat.message.post': ['guest', 'member', 'admin', 'owner'],
  'chat.message.edit_any': ['admin', 'owner'],
  'chat.message.delete_any': ['admin', 'owner'],
  'chat.message.pin': ['member', 'admin', 'owner'],
  'chat.dm.create': ['guest', 'member', 'admin', 'owner'],
}

/** Permissions whose misuse costs somebody else's words. */
const DANGEROUS = ['chat.channel.delete', 'chat.message.edit_any', 'chat.message.delete_any']

describe('chat permissions', () => {
  it('grants each permission to exactly the blessed roles', () => {
    expect(permissionMatrixDiff(chatPermissions, BLESSED)).toEqual([])
  })

  it('namespaces every key under the module id and declares it once', () => {
    const keys = chatPermissions.map((p) => p.key)
    expect(keys.filter((key) => !key.startsWith('chat.'))).toEqual([])
    expect(keys.filter((key, i) => keys.indexOf(key) !== i)).toEqual([])
  })

  it('marks exactly the destructive permissions dangerous', () => {
    const flagged = chatPermissions.filter((p) => p.dangerous).map((p) => p.key)
    expect(flagged.toSorted()).toEqual(DANGEROUS.toSorted())
  })
})
