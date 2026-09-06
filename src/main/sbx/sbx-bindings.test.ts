import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { readSbxBinding, saveSbxBinding } from './sbx-bindings'
const state = vi.hoisted(() => ({ path: '' }))
vi.mock('../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => state.path
}))
describe('durable sandbox ownership', () => {
  beforeEach(async () => {
    state.path = await mkdtemp(join(tmpdir(), 'orca-sbx-bindings-'))
  })
  afterEach(async () => {
    await rm(state.path, { recursive: true, force: true })
  })
  const binding = {
    name: 'orca-claude-test',
    sandboxId: 'id-1',
    agent: 'claude',
    workspace: '/project',
    paneIdentity: 'pane',
    connectionId: null
  }
  it('persists immutable sandbox IDs and scopes the same name to its host', async () => {
    await saveSbxBinding(binding)
    expect(await readSbxBinding(binding.name)).toEqual(binding)
    expect(await readSbxBinding(binding.name, 'remote')).toBeNull()
    await saveSbxBinding({ ...binding, sandboxId: 'remote-id', connectionId: 'remote' })
    expect((await readSbxBinding(binding.name))?.sandboxId).toBe('id-1')
    expect((await readSbxBinding(binding.name, 'remote'))?.sandboxId).toBe('remote-id')
  })
  it('fails closed when ownership storage is unreadable', async () => {
    await writeFile(join(state.path, 'sbx-bindings'), 'not a directory')
    await expect(readSbxBinding(binding.name)).rejects.toThrow()
  })
})
