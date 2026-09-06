import { expect, it } from 'vitest'
import { CodexStructuredSessionAdapter } from '../codex/codex-structured-session-adapter'
import { SbxClient } from './sbx-client'

it.skipIf(process.env.ORCA_SBX_NATIVE_SMOKE !== '1')(
  'acquires a native Codex thread inside a real guest',
  async () => {
    const name = process.env.ORCA_SBX_NATIVE_SMOKE_NAME
    const codexHome = process.env.ORCA_SBX_CODEX_HOME
    if (!name || !codexHome) {
      throw new Error('Provide a disposable sandbox name and its guest CODEX_HOME.')
    }
    const client = new SbxClient()
    const sandbox = (await client.list()).find((entry) => entry.name === name)
    if (!sandbox) {
      throw new Error('Create a disposable Codex sandbox first.')
    }
    let resumeThreadId: string | null = null
    const adapter = new CodexStructuredSessionAdapter({
      requestTimeoutMs: 15_000,
      resolveLaunch: async () => ({
        command: 'codex',
        args: ['app-server'],
        cwd: sandbox.workspaces[0],
        codexHome,
        resumeThreadId,
        sandbox: { name, sandboxId: sandbox.id, workspace: sandbox.workspaces[0] }
      })
    })
    const identity = {
      sessionId: 'sbx-native-acquire-smoke',
      workspaceId: 'smoke',
      hostId: 'local',
      agent: 'codex' as const,
      providerHandle: { kind: 'codex' as const, threadId: 'pending' }
    }
    try {
      const acquired = await adapter.acquire({
        identity,
        fence: 1,
        spawnToken: 'sbx-native-acquire-smoke'
      })
      expect(acquired.process.pid).toBeGreaterThan(0)
      expect(acquired.link.handle).toMatchObject({
        provider: 'codex',
        threadId: expect.any(String)
      })
      expect(await adapter.historyFilePath({ identity })).toBeNull()
      if (acquired.link.handle.provider !== 'codex') {
        throw new Error('Expected a Codex thread.')
      }
      const dispatched = await adapter.dispatch({
        sessionId: identity.sessionId,
        fence: 1,
        clientMessageId: 'smoke-message',
        body: {
          kind: 'message',
          role: 'user',
          blocks: [{ type: 'text', text: 'Reply only OK. Do not run commands or modify files.' }]
        }
      })
      if (dispatched.state !== 'accepted' || dispatched.providerIdentity.provider !== 'codex') {
        throw new Error('The guest did not accept the smoke-test turn.')
      }
      const turnId = dispatched.providerIdentity.turnId
      const cancellation = await adapter.cancelTurn({
        sessionId: identity.sessionId,
        fence: 1,
        turnId
      })
      expect(cancellation.cancelled).toBe(true)
      resumeThreadId = acquired.link.handle.threadId
      expect(await adapter.closeSession(identity.sessionId)).toBe(true)
      const resumed = await adapter.acquire({
        identity: { ...identity, providerHandle: { kind: 'codex', threadId: resumeThreadId } },
        fence: 2,
        spawnToken: 'sbx-native-resume-smoke'
      })
      expect(resumed.link.handle).toEqual(acquired.link.handle)
    } finally {
      await adapter.closeAll()
    }
    expect((await client.list()).find((entry) => entry.id === sandbox.id)?.status).toBe('stopped')
  },
  120_000
)
