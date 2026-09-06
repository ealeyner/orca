import { beforeEach, describe, expect, it, vi } from 'vitest'
import { changeSbxLifecycle } from './sbx-lifecycle'
const mocks = vi.hoisted(() => ({ list: vi.fn(), run: vi.fn() }))
vi.mock('./sbx-client', () => ({
  SbxClient: class {
    list = mocks.list
    run = mocks.run
  }
}))
const sandbox = { name: 'one', id: 'owned', status: 'running' }
const target = { name: 'one', sandboxId: 'owned' }

describe('sandbox lifecycle evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.run.mockResolvedValue('')
    mocks.list.mockResolvedValue([sandbox])
  })
  it('refuses a stale selection before any mutation', async () => {
    mocks.list.mockResolvedValue([{ ...sandbox, id: 'replacement' }])
    await expect(changeSbxLifecycle({ ...target, action: 'remove' })).rejects.toThrow(
      'identity changed'
    )
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('does not treat successful CLI exit as guest exit evidence', async () => {
    await expect(changeSbxLifecycle({ ...target, action: 'stop' })).rejects.toThrow(
      'exit is unverifiable'
    )
  })
  it('proves stop using a fresh inventory read', async () => {
    mocks.list
      .mockResolvedValueOnce([sandbox])
      .mockResolvedValueOnce([{ ...sandbox, status: 'stopped' }])
    await expect(changeSbxLifecycle({ ...target, action: 'stop' })).resolves.toBeUndefined()
    expect(mocks.run).toHaveBeenCalledWith(['stop', 'one'], 300_000)
  })
  it('does not report removal while the immutable sandbox ID remains', async () => {
    await expect(changeSbxLifecycle({ ...target, action: 'remove' })).rejects.toThrow(
      'removal is unverifiable'
    )
  })
  it('avoids restarting an already running agent', async () => {
    await changeSbxLifecycle({ ...target, action: 'start' })
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('keeps a lost host unverifiable after a stop request', async () => {
    mocks.list
      .mockResolvedValueOnce([sandbox])
      .mockRejectedValueOnce(new Error('host unverifiable'))
    await expect(
      changeSbxLifecycle({ ...target, action: 'stop', connectionId: 'remote' })
    ).rejects.toThrow('unverifiable')
  })
})
