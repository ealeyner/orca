import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reserveSbxNativeProvider } from './sbx-native-reservation'
const mocks = vi.hoisted(() => ({ list: vi.fn(), run: vi.fn() }))
vi.mock('./sbx-client', () => ({
  SbxClient: class {
    list = mocks.list
    run = mocks.run
  }
}))
const target = { name: 'native', sandboxId: 'reservation-test-id', workspace: '/project' }
describe('native sandbox reservation generations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue([
      {
        name: target.name,
        id: target.sandboxId,
        agent: 'codex',
        status: 'stopped',
        workspaces: ['/project']
      }
    ])
  })
  it('does not let an old release remove a new reservation', async () => {
    const old = await reserveSbxNativeProvider(target, 'codex')
    old.release()
    const current = await reserveSbxNativeProvider(target, 'codex')
    old.release()
    await expect(reserveSbxNativeProvider(target, 'codex')).rejects.toThrow('already has')
    expect(await old.confirmExecutionExit()).toBe(false)
    expect(mocks.run).not.toHaveBeenCalled()
    expect(await current.confirmExecutionExit()).toBe(true)
  })
  it('never repeats proven shutdown against a later connection', async () => {
    const old = await reserveSbxNativeProvider(target, 'codex')
    expect(await old.confirmExecutionExit()).toBe(true)
    const current = await reserveSbxNativeProvider(target, 'codex')
    const reads = mocks.list.mock.calls.length
    expect(await old.confirmExecutionExit()).toBe(true)
    expect(mocks.list).toHaveBeenCalledTimes(reads)
    await expect(reserveSbxNativeProvider(target, 'codex')).rejects.toThrow('already has')
    expect(await current.confirmExecutionExit()).toBe(true)
  })
})
