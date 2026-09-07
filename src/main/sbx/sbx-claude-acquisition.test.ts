import { expect, it, vi } from 'vitest'
import {
  adapterFor,
  fakeClaude,
  identityFor
} from '../claude/claude-structured-session-test-support'
import { SbxClaudeStartUnprovenError } from './sbx-claude-connection'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('./sbx-client', () => ({
  SbxClient: class {
    list = mocks.list
  }
}))
const sandbox = {
  name: 'native-claude',
  id: 'guest-claude',
  agent: 'claude',
  status: 'stopped',
  workspaces: ['/work/repo']
}
const target = { name: sandbox.name, sandboxId: sandbox.id, workspace: '/work/repo' }

it('acquires through the guest SDK without consulting host transcript files', async () => {
  mocks.list.mockResolvedValue([sandbox])
  const claude = fakeClaude()
  const readHostTranscript = vi.fn(async () => {
    throw new Error('host transcript access')
  })
  const adapter = adapterFor(claude, { sandbox: target }, [], [], undefined, readHostTranscript)
  try {
    await adapter.acquire({ identity: identityFor(), fence: 7, spawnToken: 'spawn-9' })
    expect(claude.connections[0].launch).toMatchObject({
      pathToClaudeCodeExecutable: 'claude',
      usesHostCredentials: false,
      env: { ORCA_AGENT_SESSION_SPAWN_TOKEN: 'spawn-9' }
    })
    expect(claude.connections[0].launch.env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
    await adapter.closeAll()
    expect(readHostTranscript).not.toHaveBeenCalled()
  } finally {
    await adapter.closeAll()
    await claude.connections[0]?.launch.confirmExecutionExit?.()
  }
})

it('retains partial SDK startup cleanup until a release retry proves guest shutdown', async () => {
  mocks.list.mockResolvedValue([sandbox])
  const claude = fakeClaude()
  const cleanup = vi.fn().mockResolvedValue(false)
  claude.openConnection = async () => {
    throw new SbxClaudeStartUnprovenError(4321, cleanup, new Error('startup'))
  }
  const adapter = adapterFor(claude, { sandbox: target })
  await expect(
    adapter.acquire({ identity: identityFor(), fence: 7, spawnToken: 'spawn-9' })
  ).rejects.toThrow('agent_session_acquisition_exit_unproven')
  expect(cleanup).toHaveBeenCalledOnce()
  await expect(adapter.releaseAcquisition({ sessionId: 'session-1' })).resolves.toBe(false)
  cleanup.mockResolvedValue(true)
  await expect(adapter.releaseAcquisition({ sessionId: 'session-1' })).resolves.toBe(true)
  expect(cleanup).toHaveBeenCalledTimes(3)
})
