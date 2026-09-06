import { expect, it, vi } from 'vitest'
import { CodexStructuredSessionAdapter } from '../codex/codex-structured-session-adapter'
import type { CodexAppServerLaunch } from '../codex/codex-app-server-connection'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('./sbx-client', () => ({
  SbxClient: class {
    list = mocks.list
  }
}))

it('acquires and resumes through the sandbox transport with a guest account pin', async () => {
  mocks.list.mockResolvedValue([
    { name: 'native', id: 'guest-1', agent: 'codex', status: 'stopped', workspaces: ['/project'] }
  ])
  const requests = vi.fn(async () => ({ thread: { id: 'thread-1', path: '/guest/rollout.jsonl' } }))
  let captured: CodexAppServerLaunch | undefined
  const hostProcessScan = vi.fn(() => {
    throw new Error('Host process scan must not inspect guest turns.')
  })
  const adapter = new CodexStructuredSessionAdapter({
    captureTurnProcesses: hostProcessScan,
    terminateTurnProcesses: hostProcessScan,
    resolveLaunch: async () => ({
      command: 'codex',
      args: ['--config', 'model_reasoning_effort="low"', 'app-server'],
      cwd: '/project',
      codexHome: '/guest/.codex',
      resumeThreadId: 'thread-1',
      sandbox: { name: 'native', sandboxId: 'guest-1', workspace: '/project' }
    }),
    openConnection: async (launch) => {
      captured = launch
      return {
        pid: 4321,
        closed: false,
        request: requests,
        notify: () => {},
        respond: () => {},
        respondWithError: () => {},
        close: async () => (await launch.confirmExecutionExit?.()) === true
      }
    },
    readProcessStartTime: async () => 1700000000000
  })
  const identity = {
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    hostId: 'local',
    agent: 'codex' as const,
    providerHandle: { kind: 'codex' as const, threadId: 'thread-1' }
  }
  try {
    await adapter.acquire({ identity, fence: 1, spawnToken: 'spawn-1' })
    expect(captured?.args).toEqual([
      'exec',
      '-i',
      '-w',
      '/project',
      '--',
      'native',
      'env',
      'CODEX_HOME=/guest/.codex',
      'codex',
      '--config',
      'model_reasoning_effort="low"',
      'app-server'
    ])
    expect(captured?.env).toEqual({ ORCA_AGENT_SESSION_SPAWN_TOKEN: 'spawn-1' })
    expect(await adapter.historyFilePath({ identity })).toBeNull()
    expect(
      await adapter.cancelTurn({ sessionId: identity.sessionId, fence: 1, turnId: 'turn-1' })
    ).toEqual({ cancelled: true })
    expect(hostProcessScan).not.toHaveBeenCalled()
    expect(requests.mock.calls[0]).toEqual([
      'thread/resume',
      { threadId: 'thread-1', cwd: '/project', excludeTurns: true },
      { timeoutMs: undefined }
    ])
  } finally {
    await adapter.closeAll()
  }
})
