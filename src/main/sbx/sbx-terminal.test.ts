import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { resolveSbxTerminalLaunch } from './sbx-terminal'

const mocks = vi.hoisted(() => ({ list: vi.fn(), binding: vi.fn(), platform: vi.fn() }))
vi.mock('./sbx-client', () => ({
  SbxClient: class {
    list = mocks.list
  }
}))
vi.mock('./sbx-bindings', () => ({ readSbxBinding: mocks.binding }))
vi.mock('../ssh/ssh-target-registry', () => ({ getRegisteredSshState: mocks.platform }))

function runtime(hostId = 'local') {
  return {
    listManagedWorktrees: vi.fn(async () => ({
      worktrees: [{ id: 'workspace', path: '/project', hostId }]
    })),
    getClientSettings: vi.fn(() => ({ sbx: { enabled: true, agents: {} } })),
    createTerminal: vi.fn(async () => ({ tabId: 'tab' }))
  }
}

describe('sandbox terminal attachment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue([
      { id: 'owned', name: 'one', agent: 'claude', workspaces: ['/project'] }
    ])
    mocks.binding.mockResolvedValue(null)
    mocks.platform.mockReturnValue({ remotePlatform: 'linux' })
  })
  it('opens a guest shell in the workspace on its owning host', async () => {
    const owner = runtime('ssh:remote')
    const launch = await resolveSbxTerminalLaunch(
      owner as unknown as OrcaRuntimeService,
      'one',
      'shell',
      'remote'
    )
    expect(launch).toEqual(
      expect.objectContaining({
        command: expect.stringContaining('exec'),
        cwd: '/project',
        worktreeId: 'workspace'
      })
    )
  })
  it('never opens an SSH sandbox through a matching local workspace', async () => {
    const owner = runtime()
    await expect(
      resolveSbxTerminalLaunch(owner as unknown as OrcaRuntimeService, 'one', 'shell', 'remote')
    ).rejects.toThrow('SSH host')
    expect(owner.createTerminal).not.toHaveBeenCalled()
  })
  it('refuses to attach to a same-name replacement', async () => {
    mocks.binding.mockResolvedValue({ sandboxId: 'replaced', agent: 'claude' })
    const owner = runtime()
    await expect(
      resolveSbxTerminalLaunch(owner as unknown as OrcaRuntimeService, 'one', 'agent')
    ).rejects.toThrow('identity changed')
    expect(owner.createTerminal).not.toHaveBeenCalled()
  })
  it('reopens a template agent through exec rather than the template shell agent', async () => {
    mocks.list.mockResolvedValue([
      { id: 'owned', name: 'one', agent: 'shell', workspaces: ['/project'] }
    ])
    mocks.binding.mockResolvedValue({ sandboxId: 'owned', agent: 'pi', workspace: '/project' })
    const owner = runtime()
    const launch = await resolveSbxTerminalLaunch(
      owner as unknown as OrcaRuntimeService,
      'one',
      'agent'
    )
    expect(launch).toEqual(
      expect.objectContaining({ command: expect.stringContaining('exec'), title: 'one · pi' })
    )
  })
})
