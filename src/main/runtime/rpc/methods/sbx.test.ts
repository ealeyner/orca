import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { SBX_METHODS } from './sbx'
const mocks = vi.hoisted(() => ({ run: vi.fn(), list: vi.fn(), create: vi.fn() }))
vi.mock('../../../sbx/sbx-client', () => ({
  SbxClient: class {
    run = mocks.run
    list = mocks.list
    create = mocks.create
  }
}))
vi.mock('../../../sbx/sbx-bindings', () => ({
  readSbxBinding: vi.fn(async () => null),
  saveSbxBinding: vi.fn(async () => {})
}))
const dispatcher = new RpcDispatcher({
  runtime: {
    getRuntimeId: () => 'test',
    getClientSettings: () => ({ sbx: { enabled: true, agents: { codex: { enabled: false } } } })
  } as unknown as OrcaRuntimeService,
  methods: SBX_METHODS
})
const call = (method: string, params: unknown) =>
  dispatcher.dispatch({ id: '1', authToken: 'test', method, params })
describe('sandbox control RPC boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.run.mockResolvedValue('denied')
    mocks.list.mockResolvedValue([])
  })
  it('always scopes network mutations to the selected sandbox', async () => {
    expect(
      await call('sbx.network', { name: 'one', action: 'deny', resource: '*.example.com' })
    ).toMatchObject({ ok: true })
    expect(mocks.run).toHaveBeenCalledWith(
      ['policy', 'deny', 'network', '--sandbox', 'one', '--', '*.example.com'],
      30_000,
      [0]
    )
  })
  it('returns denied access as a check result', async () => {
    expect(
      await call('sbx.network', { name: 'one', action: 'check', resource: 'example.com' })
    ).toMatchObject({ ok: true, result: 'denied' })
    expect(mocks.run).toHaveBeenCalledWith(expect.any(Array), 30_000, [0, 1])
  })
  it('rejects option injection and unknown actions before executing a command', async () => {
    expect(await call('sbx.lifecycle', { name: '--all', action: 'remove' })).toMatchObject({
      ok: false
    })
    expect(await call('sbx.lifecycle', { name: 'one', action: 'reset' })).toMatchObject({
      ok: false
    })
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('removes exactly one selected sandbox, never all', async () => {
    expect(await call('sbx.lifecycle', { name: 'one', action: 'remove' })).toMatchObject({
      ok: true
    })
    expect(mocks.run).toHaveBeenCalledWith(['rm', '--force', 'one'], 300_000)
  })
  it('cannot bypass a disabled agent through manual creation', async () => {
    expect(
      await call('sbx.create', { name: 'one', agent: 'codex', workspace: '/project' })
    ).toMatchObject({ ok: false })
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
