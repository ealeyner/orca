import type * as SbxLifecycle from './sbx-lifecycle'
import { beforeEach, expect, it, vi } from 'vitest'
import { prepareSbxNativeSession } from './sbx-native-session-preparation'
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  ensure: vi.fn(),
  list: vi.fn(),
  run: vi.fn(),
  stop: vi.fn(),
  reserve: vi.fn(),
  confirm: vi.fn()
}))
vi.mock('./sbx-agent-sandbox', () => ({
  sandboxNameForPane: () => 'native-one',
  ensureSbxAgentSandbox: mocks.ensure
}))
vi.mock('./sbx-bindings', () => ({ readSbxBinding: mocks.read, saveSbxBinding: mocks.save }))
vi.mock('./sbx-client', () => ({
  SbxClient: class {
    list = mocks.list
    run = mocks.run
  }
}))
vi.mock('./sbx-native-reservation', () => ({ reserveSbxNativeProvider: mocks.reserve }))
vi.mock('./sbx-lifecycle', async (original) => ({
  ...(await original<typeof SbxLifecycle>()),
  stopSbxExecution: mocks.stop
}))
const binding = {
  name: 'native-one',
  sandboxId: 'guest-1',
  paneIdentity: 'native:session-1',
  agent: 'claude',
  workspace: '/project',
  connectionId: null
}
const guest = {
  name: binding.name,
  id: binding.sandboxId,
  agent: 'claude',
  status: 'stopped',
  workspaces: ['/project']
}
const home = { variable: 'CLAUDE_CONFIG_DIR', path: '/guest/.claude' }
const input = {
  sessionId: 'session-1',
  provider: 'claude' as const,
  workspace: '/project',
  settings: { enabled: true }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.read.mockResolvedValue(binding)
  mocks.ensure.mockResolvedValue(true)
  mocks.list.mockResolvedValue([guest])
  mocks.run.mockResolvedValue(JSON.stringify(home))
  mocks.confirm.mockResolvedValue(true)
  mocks.reserve.mockResolvedValue({ confirmExecutionExit: mocks.confirm })
})

it('uses launch policy and pins the discovered guest root only after shutdown proof', async () => {
  const result = await prepareSbxNativeSession({
    ...input,
    settings: {
      enabled: true,
      agents: {
        claude: { enabled: true, denyNetwork: ['example.com'], staticMcp: [], workspaces: [] }
      }
    }
  })
  expect(result).toEqual({
    sandbox: { kind: 'docker-sandbox', id: 'guest-1', name: 'native-one' },
    accountHome: home
  })
  expect(mocks.ensure).toHaveBeenCalledWith(
    expect.objectContaining({
      paneIdentity: 'native:session-1',
      policy: expect.objectContaining({ denyNetwork: ['example.com'] })
    })
  )
  expect(mocks.stop).toHaveBeenCalledOnce()
  expect(mocks.save).toHaveBeenCalledWith({ ...binding, nativeAccountHome: home })
  expect(mocks.confirm.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.save.mock.invocationCallOrder[0]
  )
})

it('reuses a running pinned guest without inspecting or stopping it', async () => {
  mocks.read.mockResolvedValue({ ...binding, nativeAccountHome: home })
  mocks.list.mockResolvedValue([{ ...guest, status: 'running' }])
  expect((await prepareSbxNativeSession(input)).accountHome).toEqual(home)
  expect(mocks.ensure).not.toHaveBeenCalled()
  expect(mocks.run).not.toHaveBeenCalled()
  expect(mocks.stop).not.toHaveBeenCalled()
})

it('never recreates a removed guest under a pinned native identity', async () => {
  mocks.read.mockResolvedValue({ ...binding, nativeAccountHome: home })
  mocks.list.mockResolvedValue([])
  await expect(prepareSbxNativeSession(input)).rejects.toThrow('identity changed')
  expect(mocks.ensure).not.toHaveBeenCalled()
})

it('enforces agent disablement before provisioning', async () => {
  await expect(prepareSbxNativeSession({ ...input, settings: { enabled: false } })).rejects.toThrow(
    'not enabled'
  )
  await expect(
    prepareSbxNativeSession({
      ...input,
      settings: {
        enabled: true,
        agents: { claude: { enabled: false, denyNetwork: [], staticMcp: [], workspaces: [] } }
      }
    })
  ).rejects.toThrow('disabled')
  expect(mocks.ensure).not.toHaveBeenCalled()
})

it('does not stop an existing unprepared guest and still proves inspection cleanup', async () => {
  mocks.ensure.mockResolvedValue(false)
  mocks.run.mockResolvedValue(JSON.stringify({ ...home, path: 'relative' }))
  await expect(prepareSbxNativeSession(input)).rejects.toThrow('could not be verified')
  expect(mocks.stop).not.toHaveBeenCalled()
  expect(mocks.confirm).toHaveBeenCalledOnce()
  expect(mocks.save).not.toHaveBeenCalled()
})

it('retains and retries unproven inspection cleanup before another preparation', async () => {
  mocks.confirm.mockResolvedValue(false)
  await expect(prepareSbxNativeSession(input)).rejects.toThrow('shutdown proof')
  expect(mocks.save).not.toHaveBeenCalled()
  await expect(prepareSbxNativeSession(input)).rejects.toThrow('still unverifiable')
  expect(mocks.ensure).toHaveBeenCalledOnce()
  mocks.confirm.mockResolvedValue(true)
  await expect(prepareSbxNativeSession(input)).resolves.toMatchObject({ accountHome: home })
})

it('coalesces duplicate creation and rejects a conflicting workspace', async () => {
  const wait = Promise.withResolvers<string>()
  mocks.run.mockReturnValue(wait.promise)
  const first = prepareSbxNativeSession(input)
  const second = prepareSbxNativeSession(input)
  await expect(prepareSbxNativeSession({ ...input, workspace: '/other' })).rejects.toThrow(
    'workspace changed'
  )
  wait.resolve(JSON.stringify(home))
  expect(await first).toEqual(await second)
  expect(mocks.ensure).toHaveBeenCalledOnce()
})
