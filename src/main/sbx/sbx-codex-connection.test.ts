import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openSbxCodexConnection } from './sbx-codex-connection'
const mocks = vi.hoisted(() => ({ list: vi.fn(), run: vi.fn(), open: vi.fn() }))
vi.mock('./sbx-client', () => ({
  SbxClient: class {
    list = mocks.list
    run = mocks.run
  }
}))
vi.mock('../codex/codex-app-server-connection', () => ({
  openCodexAppServerConnection: mocks.open
}))
const sandbox = {
  name: 'native-one',
  id: 'native-id',
  agent: 'codex',
  status: 'stopped',
  workspaces: ['/project']
}
const input = { name: sandbox.name, sandboxId: sandbox.id, workspace: '/project' }
describe('sandbox native Codex connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue([sandbox])
    mocks.run.mockResolvedValue('')
    mocks.open.mockResolvedValue({})
  })
  it('runs stdio in the guest without forwarding the host environment or allocating a tty', async () => {
    await openSbxCodexConnection(input)
    const launch = mocks.open.mock.calls[0][0]
    expect(launch.args).toEqual([
      'exec',
      '-i',
      '-w',
      '/project',
      '--',
      'native-one',
      'codex',
      'app-server'
    ])
    expect(launch.env).toBeUndefined()
    await expect(openSbxCodexConnection(input)).rejects.toThrow('already has')
    expect(await launch.confirmExecutionExit()).toBe(true)
  })
  it('refuses an existing running sandbox rather than starting a second native provider', async () => {
    mocks.list.mockResolvedValue([{ ...sandbox, status: 'running' }])
    await expect(openSbxCodexConnection(input)).rejects.toThrow('Stop the sandbox')
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it('refuses a different guest identity before opening a transport', async () => {
    mocks.list.mockResolvedValue([{ ...sandbox, id: 'replacement' }])
    await expect(openSbxCodexConnection(input)).rejects.toThrow('identity changed')
    expect(mocks.open).not.toHaveBeenCalled()
  })
})
