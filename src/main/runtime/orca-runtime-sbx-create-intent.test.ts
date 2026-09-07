import { expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
const prepare = vi.hoisted(() => vi.fn())
vi.mock('../sbx/sbx-native-session-preparation', () => ({ prepareSbxNativeSession: prepare }))

it('pins the prepared guest instead of resolving a host account', async () => {
  const prepared = {
    sandbox: { kind: 'docker-sandbox', id: 'guest-1', name: 'native-one' },
    accountHome: { variable: 'CODEX_HOME', path: '/guest/.codex' }
  }
  prepare.mockResolvedValue(prepared)
  const prepareCodexStructuredLaunch = vi.fn(() => {
    throw new Error('Host account access')
  })
  const settings = { sbx: { enabled: true } }
  const runtime = new OrcaRuntimeService({ getSettings: () => settings } as never, undefined, {
    prepareCodexStructuredLaunch
  })
  vi.spyOn(runtime, 'getStructuredAgentSessionCreateSupport').mockResolvedValue({ supported: true })
  const internal = runtime as unknown as {
    resolveStructuredAgentSessionLocation: (selector: string) => Promise<unknown>
    resolveRuntimeFileTarget: (selector: string) => Promise<unknown>
  }
  internal.resolveStructuredAgentSessionLocation = async () => ({
    executionHostId: 'local',
    wslDistro: null,
    workspaceId: 'workspace-1',
    workspaceKind: 'folder'
  })
  internal.resolveRuntimeFileTarget = async () => ({ worktree: { path: '/project' } })
  const intent = await runtime.resolveStructuredAgentSessionCreateIntent({
    envelope: { sessionId: 'session-1', clientOperationId: 'operation-1' },
    worktree: 'id:workspace-1',
    agent: 'codex'
  })
  expect(intent.location).toMatchObject({ sandbox: prepared.sandbox, workspaceKind: 'folder' })
  expect(intent.accountHome).toEqual(prepared.accountHome)
  expect(prepareCodexStructuredLaunch).not.toHaveBeenCalled()
  expect(prepare).toHaveBeenCalledWith({
    sessionId: 'session-1',
    provider: 'codex',
    workspace: '/project',
    settings: settings.sbx
  })
})
