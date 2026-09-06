import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { PtySpawnOptions } from '../providers/types'
import { DEFAULT_SBX_POLICY } from '../../shared/sbx-types'
import { prepareSbxAgentLaunch, sandboxNameForPane } from './sbx-agent-launch'

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }))
vi.mock('./sbx-client', () => ({
  SbxClient: class {
    list = mocks.list
    create = mocks.create
  }
}))
vi.mock('./sbx-bindings', () => ({
  readSbxBinding: vi.fn(async () => ({ sandboxId: 'owned' })),
  saveSbxBinding: vi.fn(async () => {})
}))
const settings = { sbx: { enabled: true } } as Pick<GlobalSettings, 'sbx'>
const spawn = (): PtySpawnOptions => ({
  cols: 80,
  rows: 24,
  launchAgent: 'claude',
  cwd: '/project with spaces',
  worktreeId: 'w1',
  paneKey: 'tab:leaf',
  command: "claude 'fix $(touch /tmp/escaped)'"
})

describe('sandbox agent launch boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue([])
    mocks.create.mockResolvedValue({})
  })
  it('provisions before launching and preserves prompt bytes as agent arguments', async () => {
    const options = spawn()
    await prepareSbxAgentLaunch(options, settings)
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'claude', workspace: '/project with spaces' })
    )
    expect(options.command).toContain('sbx')
    expect(options.command).toContain('--name')
    expect(options.command).toContain('fix $(touch /tmp/escaped)')
    expect(options.commandDelivery).toBe('provider')
  })
  it('never spawns a host agent when provisioning fails', async () => {
    mocks.create.mockRejectedValue(new Error('daemon unavailable'))
    await expect(prepareSbxAgentLaunch(spawn(), settings)).rejects.toThrow('daemon unavailable')
  })
  it('refuses unsupported agents and custom host wrappers before any provisioning', async () => {
    await expect(
      prepareSbxAgentLaunch({ ...spawn(), launchAgent: 'pi' }, settings)
    ).rejects.toThrow('does not provide')
    await expect(
      prepareSbxAgentLaunch({ ...spawn(), command: 'env SECRET=value claude' }, settings)
    ).rejects.toThrow('direct agent command')
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('enforces disabled agent policies', async () => {
    await expect(
      prepareSbxAgentLaunch(spawn(), {
        sbx: { enabled: true, agents: { claude: { ...DEFAULT_SBX_POLICY, enabled: false } } }
      } as Pick<GlobalSettings, 'sbx'>)
    ).rejects.toThrow('disabled')
  })
  it('does not adopt a same-name sandbox belonging to another workspace', async () => {
    const options = spawn()
    mocks.list.mockResolvedValue([
      {
        name: sandboxNameForPane('claude', 'w1:tab:leaf'),
        agent: 'claude',
        id: 'owned',
        workspaces: ['/other']
      }
    ])
    await expect(prepareSbxAgentLaunch(options, settings)).rejects.toThrow('identity conflicts')
  })
  it('deduplicates concurrent provisioning for one pane and isolates different panes', async () => {
    await Promise.all([
      prepareSbxAgentLaunch(spawn(), settings),
      prepareSbxAgentLaunch(spawn(), settings)
    ])
    expect(mocks.create).toHaveBeenCalledTimes(1)
    await prepareSbxAgentLaunch({ ...spawn(), paneKey: 'second' }, settings)
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.create.mock.calls[0][0].name).not.toBe(mocks.create.mock.calls[1][0].name)
  })
  it('leaves ordinary shells and explicitly disabled sandbox execution unchanged', async () => {
    const options = spawn()
    await prepareSbxAgentLaunch(options, { sbx: { enabled: false } } as Pick<GlobalSettings, 'sbx'>)
    await prepareSbxAgentLaunch({ cols: 80, rows: 24 }, settings)
    expect(mocks.list).not.toHaveBeenCalled()
    expect(options.command).toBe(spawn().command)
  })
})
