import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SBX_POLICY } from '../../shared/sbx-types'
import { SbxClient, sbxCreateArgs } from './sbx-client'
const mocks = vi.hoisted(() => ({ run: vi.fn(), mux: vi.fn() }))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: mocks.run }))
vi.mock('../ssh/ssh-target-registry', () => ({ getActiveMultiplexer: mocks.mux }))
describe('sbx host routing and command contract', () => {
  beforeEach(() => vi.clearAllMocks())
  it('constructs creation argv without a shell and sets restrictions before launch', () => {
    expect(
      sbxCreateArgs({
        ...DEFAULT_SBX_POLICY,
        name: 'example',
        agent: 'codex',
        workspace: '/a b',
        denyNetwork: ['*.blocked.test'],
        workspaces: [{ path: '/docs', readOnly: true }],
        staticMcp: ['github']
      })
    ).toEqual([
      'create',
      '--name',
      'example',
      '--deny-network',
      '*.blocked.test',
      '--static-mcp',
      'github',
      'codex',
      '--',
      '/a b',
      '/docs:ro'
    ])
  })
  it('rejects option-shaped sandbox names', () => {
    expect(() =>
      sbxCreateArgs({ ...DEFAULT_SBX_POLICY, name: '--all', agent: 'shell', workspace: '/a' })
    ).toThrow()
  })
  it('reports malformed inventory as a failure, never as zero sandboxes', async () => {
    mocks.run.mockResolvedValue({ code: 0, stdout: '{}', stderr: '', timedOut: false })
    await expect(new SbxClient().list()).rejects.toThrow()
  })
  it('never falls back locally when an SSH host is unreachable', async () => {
    mocks.mux.mockReturnValue(undefined)
    await expect(new SbxClient('remote').list()).rejects.toThrow('unverifiable')
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('executes on the requested host and preserves argv', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ exitCode: 0, stdout: '{"sandboxes":[]}', stderr: '', timedOut: false })
    mocks.mux.mockReturnValue({ request })
    expect(await new SbxClient('remote').list()).toEqual([])
    expect(request).toHaveBeenCalledWith(
      'agent.execNonInteractive',
      expect.objectContaining({ binary: 'sbx', args: ['ls', '--json'] }),
      expect.any(Object)
    )
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('treats timeout as unknown outcome even if exit code is zero', async () => {
    mocks.run.mockResolvedValue({ code: 0, stdout: '', stderr: '', timedOut: true })
    await expect(new SbxClient().run(['stop', 'example'])).rejects.toThrow('unverifiable')
  })
  it('uses independent remote execution lanes for simultaneous policy reads', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
    mocks.mux.mockReturnValue({ request })
    await Promise.all([
      new SbxClient('remote').run(['policy', 'ls', 'one']),
      new SbxClient('remote').run(['policy', 'log', 'one'])
    ])
    expect(request.mock.calls[0][1].operation).not.toBe(request.mock.calls[1][1].operation)
  })
  it('does not accept a canceled remote operation as success', async () => {
    mocks.mux.mockReturnValue({
      request: vi
        .fn()
        .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false, canceled: true })
    })
    await expect(new SbxClient('remote').run(['stop', 'one'])).rejects.toThrow('unverifiable')
  })
})
