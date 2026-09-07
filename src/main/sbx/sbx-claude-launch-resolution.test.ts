import { expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import { createClaudeStructuredLaunchResolver } from '../claude/claude-structured-launch-resolution'

it('resolves guest resumes without host account or command discovery', async () => {
  const record = agentSessionRecordFixture()
  record.schemaVersion = 3
  record.location.sandbox = { kind: 'docker-sandbox', id: 'guest-1', name: 'native-claude' }
  const head = record.providerHandleChain[0].handle
  if (head.provider !== 'claude') {
    throw new Error('Expected a Claude fixture')
  }
  const host = vi.fn(() => {
    throw new Error('Host access')
  })
  const resolve = createClaudeStructuredLaunchResolver({
    store: { getRecord: () => record } as unknown as AgentSessionRecordStore,
    resolveWorkspacePath: async () => '/work/repo',
    resolveCommand: host,
    resolveEnv: host,
    resolveAuthPolicy: host,
    readManagedAccountGate: host
  })
  const launch = await resolve({
    identity: {
      sessionId: record.sessionId,
      workspaceId: 'workspace-1',
      hostId: 'local',
      agent: 'claude',
      providerHandle: { kind: 'claude', sessionId: head.sessionId, leafUuid: head.leafUuid }
    }
  })
  expect(launch).toMatchObject({
    sandbox: { name: 'native-claude', sandboxId: 'guest-1', workspace: '/work/repo' },
    pathToClaudeCodeExecutable: 'claude',
    claudeConfigDir: record.accountHome.path,
    resumed: true,
    options: { resume: head.sessionId }
  })
  expect(launch.env).toBeUndefined()
  expect(host).not.toHaveBeenCalled()
})
