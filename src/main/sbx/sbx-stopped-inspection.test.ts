import { beforeEach, expect, it, vi } from 'vitest'
import { inspectStoppedSbx, retrySbxInspectionCleanup } from './sbx-stopped-inspection'
const mocks = vi.hoisted(() => ({ reserve: vi.fn(), confirm: vi.fn() }))
vi.mock('./sbx-native-reservation', () => ({ reserveSbxNativeProvider: mocks.reserve }))
const target = { name: 'inspection-test', sandboxId: 'guest-1', workspace: '/work' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.confirm.mockResolvedValue(true)
  mocks.reserve.mockResolvedValue({ confirmExecutionExit: mocks.confirm })
})
it('withholds a read result until shutdown is proven', async () => {
  const stopped = Promise.withResolvers<boolean>()
  mocks.confirm.mockReturnValue(stopped.promise)
  const publish = vi.fn()
  const result = inspectStoppedSbx(target, 'claude', async () => 'transcript').then(publish)
  await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
  expect(publish).not.toHaveBeenCalled()
  stopped.resolve(true)
  await result
  expect(publish).toHaveBeenCalledWith('transcript')
})
it('rejects a second inspection without stopping the active reader', async () => {
  const reading = Promise.withResolvers<string>()
  const first = inspectStoppedSbx(target, 'codex', () => reading.promise)
  await vi.waitFor(() => expect(mocks.reserve).toHaveBeenCalledOnce())
  await expect(inspectStoppedSbx(target, 'codex', async () => 'second')).rejects.toThrow(
    'in progress'
  )
  await expect(retrySbxInspectionCleanup(target.name)).rejects.toThrow('in progress')
  expect(mocks.confirm).not.toHaveBeenCalled()
  reading.resolve('first')
  await expect(first).resolves.toBe('first')
})
it('preserves inspection failures after proving cleanup', async () => {
  const failure = new Error('guest transcript changed')
  await expect(
    inspectStoppedSbx(target, 'claude', async () => {
      throw failure
    })
  ).rejects.toBe(failure)
  expect(mocks.confirm).toHaveBeenCalledOnce()
})
it('retains failed cleanup and retries before allowing another read', async () => {
  mocks.confirm.mockResolvedValue(false)
  const read = vi.fn(async () => 'data')
  await expect(inspectStoppedSbx(target, 'claude', read)).rejects.toThrow('shutdown proof')
  await expect(inspectStoppedSbx(target, 'claude', read)).rejects.toThrow('still unverifiable')
  expect(read).toHaveBeenCalledOnce()
  expect(mocks.reserve).toHaveBeenCalledOnce()
  mocks.confirm.mockResolvedValue(true)
  await expect(inspectStoppedSbx(target, 'claude', read)).resolves.toBe('data')
  expect(read).toHaveBeenCalledTimes(2)
})
it('retains cleanup even when its transport throws', async () => {
  mocks.confirm.mockRejectedValue(new Error('disconnected'))
  await expect(inspectStoppedSbx(target, 'claude', async () => null)).rejects.toThrow(
    'shutdown proof'
  )
  mocks.confirm.mockResolvedValue(true)
  await retrySbxInspectionCleanup(target.name)
})
it('does not inspect when provider ownership cannot be acquired', async () => {
  mocks.reserve.mockRejectedValueOnce(new Error('provider is running'))
  const read = vi.fn()
  await expect(inspectStoppedSbx(target, 'codex', read)).rejects.toThrow('provider is running')
  expect(read).not.toHaveBeenCalled()
  expect(mocks.confirm).not.toHaveBeenCalled()
})
