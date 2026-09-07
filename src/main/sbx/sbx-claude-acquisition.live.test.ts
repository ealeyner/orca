import { expect, it } from 'vitest'
import { ClaudeStructuredSessionAdapter } from '../claude/claude-structured-session-adapter'
import {
  CLAUDE_STRUCTURED_BASE_OPTIONS,
  claudeSessionIdForOrcaSession
} from '../claude/claude-structured-launch-resolution'
import { SbxClient } from './sbx-client'

it.skipIf(process.env.ORCA_SBX_NATIVE_SMOKE !== '1')(
  'acquires, cancels, and resumes a native Claude session inside a real guest',
  async () => {
    const name = process.env.ORCA_SBX_CLAUDE_SMOKE_NAME
    const claudeConfigDir = process.env.ORCA_SBX_CLAUDE_CONFIG_DIR
    if (!name || !claudeConfigDir) {
      throw new Error('Provide a disposable Claude sandbox name and guest account directory.')
    }
    const client = new SbxClient()
    const sandbox = (await client.list()).find((entry) => entry.name === name)
    if (!sandbox) {
      throw new Error('Create the disposable Claude sandbox first.')
    }
    const sessionId = 'sbx-claude-acquire-smoke'
    const providerSessionId = claudeSessionIdForOrcaSession(sessionId)
    let resumed = false
    let leafUuid: string | null = null
    const adapter = new ClaudeStructuredSessionAdapter({
      persistHandle: async (handle) => {
        leafUuid = handle.leafUuid
      },
      resolveLaunch: async () => ({
        pathToClaudeCodeExecutable: 'claude',
        options: {
          ...CLAUDE_STRUCTURED_BASE_OPTIONS,
          ...(resumed
            ? { resume: providerSessionId, ...(leafUuid ? { resumeSessionAt: leafUuid } : {}) }
            : { sessionId: providerSessionId })
        },
        cwd: sandbox.workspaces[0],
        claudeConfigDir,
        providerSessionId,
        resumeLeafUuid: leafUuid,
        resumed,
        sandbox: { name, sandboxId: sandbox.id, workspace: sandbox.workspaces[0] }
      }),
      requestTimeoutMs: 15_000
    })
    const identity = {
      sessionId,
      workspaceId: 'smoke',
      hostId: 'local',
      agent: 'claude' as const,
      providerHandle: { kind: 'opaque' as const, agent: 'claude' as const, value: 'pending' }
    }
    try {
      const acquired = await adapter.acquire({
        identity,
        fence: 1,
        spawnToken: 'sbx-claude-acquire-smoke'
      })
      expect(acquired.process.pid).toBeGreaterThan(0)
      expect(acquired.link.handle).toEqual({
        provider: 'claude',
        sessionId: providerSessionId,
        leafUuid: null
      })
      const dispatched = await adapter.dispatch({
        sessionId,
        fence: 1,
        clientMessageId: 'smoke-message',
        body: {
          kind: 'message',
          role: 'user',
          blocks: [{ type: 'text', text: 'Reply only OK. Do not run commands or modify files.' }]
        }
      })
      if (dispatched.state !== 'accepted' || dispatched.providerIdentity.provider !== 'claude') {
        throw new Error(`Guest turn was not accepted: ${JSON.stringify(dispatched)}`)
      }
      expect(
        await adapter.cancelTurn({ sessionId, fence: 1, turnId: dispatched.providerIdentity.uuid })
      ).toEqual({ cancelled: true })
      expect(await adapter.closeSession(sessionId)).toBe(true)
      expect(leafUuid).toBeTypeOf('string')
      const pinnedLeaf = leafUuid
      resumed = true
      const reopened = await adapter.acquire({
        identity: {
          ...identity,
          providerHandle: { kind: 'claude', sessionId: providerSessionId, leafUuid }
        },
        fence: 2,
        spawnToken: 'sbx-claude-resume-smoke'
      })
      expect(reopened.link.handle).toEqual({
        provider: 'claude',
        sessionId: providerSessionId,
        leafUuid: pinnedLeaf
      })
      expect(reopened.link.origin).toBe('resumed')
    } finally {
      await adapter.closeAll()
    }
    expect((await client.list()).find((entry) => entry.id === sandbox.id)?.status).toBe('stopped')
  },
  120_000
)
