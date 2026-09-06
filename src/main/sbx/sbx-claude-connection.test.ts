import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessSpec } from '../../shared/child-process/process-spec'
import type { spawnProcess } from '../../shared/child-process/run-process'
import { openSbxClaudeConnection, SbxClaudeStartUnprovenError } from './sbx-claude-connection'

const mocks = vi.hoisted(() => ({ list: vi.fn(), run: vi.fn(), open: vi.fn(), prove: vi.fn() }))
vi.mock('./sbx-client', () => ({
  SbxClient: class {
    list = mocks.list
    run = mocks.run
  }
}))
vi.mock('../claude/claude-stream-json-connection', () => ({
  openClaudeStreamJsonConnection: mocks.open
}))
vi.mock('../claude/claude-agent-sdk-exit-proof', () => ({
  createClaudeChildTreeReaper: () => ({ capture: async () => {} }),
  proveClaudeChildExit: mocks.prove
}))
const target = { name: 'claude-native', sandboxId: 'claude-native-id', workspace: '/project' }
const child = () =>
  Object.assign(new EventEmitter(), {
    pid: 9_999_999,
    exitCode: null,
    signalCode: null
  }) as ReturnType<typeof spawnProcess>

describe('sandbox Claude SDK connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue([
      {
        name: target.name,
        id: target.sandboxId,
        agent: 'claude',
        status: 'stopped',
        workspaces: ['/project']
      }
    ])
    mocks.prove.mockResolvedValue(true)
    mocks.open.mockResolvedValue({})
  })
  it('uses the guest CLI while preserving the SDK permission protocol', async () => {
    const spawn = vi.fn((_spec: ProcessSpec) => child())
    mocks.open.mockImplementation(async (launch, _handlers, spawnImpl) => {
      spawnImpl({
        program: 'claude',
        args: ['--input-format', 'stream-json', '--permission-prompt-tool', 'stdio'],
        env: { PRIVATE_HOST_VALUE: 'host-only' }
      })
      return { close: launch.confirmExecutionExit }
    })
    const canUseTool = vi.fn()
    const connection = await openSbxClaudeConnection(target, { canUseTool }, mocks.open, spawn)
    expect(spawn.mock.calls[0][0]).toMatchObject({
      args: [
        'exec',
        '-i',
        '-w',
        '/project',
        '--',
        'claude-native',
        'claude',
        '--input-format',
        'stream-json',
        '--permission-prompt-tool',
        'stdio'
      ]
    })
    expect(mocks.open.mock.calls[0][0]).toMatchObject({
      usesHostCredentials: false,
      pathToClaudeCodeExecutable: 'claude'
    })
    expect(mocks.open.mock.calls[0][1].canUseTool).toBe(canUseTool)
    expect(await connection.close()).toBe(true)
  })
  it('retains failed SDK startup until transport and guest cleanup are proven', async () => {
    mocks.prove.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    mocks.open.mockImplementationOnce(async (_launch, _handlers, spawnImpl) => {
      spawnImpl({ program: 'claude', args: [] })
      throw new Error('SDK initialization rejected')
    })
    const failure = await openSbxClaudeConnection(target, {}, mocks.open, () => child()).catch(
      (error) => error
    )
    expect(failure).toBeInstanceOf(SbxClaudeStartUnprovenError)
    await expect(openSbxClaudeConnection(target)).rejects.toThrow('already has')
    expect(await failure.retryShutdown()).toBe(true)
    await openSbxClaudeConnection(target)
    await mocks.open.mock.calls.at(-1)![0].confirmExecutionExit()
  })
  it('releases a reservation when SDK validation fails before any child starts', async () => {
    mocks.open.mockRejectedValueOnce(new Error('invalid options'))
    await expect(openSbxClaudeConnection(target)).rejects.toThrow('invalid options')
    await openSbxClaudeConnection(target)
    await mocks.open.mock.calls.at(-1)![0].confirmExecutionExit()
  })
})
