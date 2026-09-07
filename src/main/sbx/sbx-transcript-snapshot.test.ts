import { mkdtemp, readFile, rm, symlink, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { withSbxTranscriptSnapshot } from './sbx-transcript-snapshot'
const mocks = vi.hoisted(() => ({ run: vi.fn(), inspect: vi.fn(), identity: vi.fn() }))
vi.mock('./sbx-client', () => ({
  SbxClient: class {
    run = mocks.run
  }
}))
vi.mock('./sbx-lifecycle', () => ({ requireSbxIdentity: mocks.identity }))
vi.mock('./sbx-stopped-inspection', () => ({ inspectStoppedSbx: mocks.inspect }))
let root: string
let stopped: boolean
const target = { name: 'snapshot-test', sandboxId: 'guest-1', workspace: '/work' }
const input = () => ({
  target,
  provider: 'claude' as const,
  accountHome: root,
  transcriptPath: join(root, 'session.jsonl')
})
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-transcript-test-'))
  stopped = false
  vi.resetAllMocks()
  mocks.inspect.mockImplementation(async (_target, _provider, inspect) => {
    await inspect()
    stopped = true
  })
  mocks.identity.mockResolvedValue({ id: target.sandboxId })
  mocks.run.mockImplementation(async (args: string[]) => {
    const result = await runProcess({
      program: process.execPath,
      args: args.slice(4),
      timeoutMs: 5000,
      maxOutputBytes: 1024 * 1024
    })
    if (result.code !== 0) {
      throw new Error(result.stderr)
    }
    return result.stdout
  })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
it('copies multi-chunk UTF-8 transcripts and removes the snapshot after consumption', async () => {
  const text = `${JSON.stringify({ text: 'α🙂'.repeat(1000) })}\n`.repeat(360)
  await writeFile(input().transcriptPath, text)
  let snapshot = ''
  await withSbxTranscriptSnapshot(input(), async (path) => {
    snapshot = path
    expect(stopped).toBe(true)
    expect(await readFile(path, 'utf8')).toBe(text)
  })
  expect(mocks.run.mock.calls.length).toBeGreaterThan(8)
  await expect(access(snapshot)).rejects.toThrow()
})
it('accepts an empty transcript without looping', async () => {
  await writeFile(input().transcriptPath, '')
  await withSbxTranscriptSnapshot(input(), async (path) =>
    expect(await readFile(path, 'utf8')).toBe('')
  )
  expect(mocks.run).toHaveBeenCalledOnce()
})
it('refuses a transcript that changes between chunks', async () => {
  await writeFile(input().transcriptPath, 'x'.repeat(300000))
  mocks.identity.mockImplementation(async () => {
    if (mocks.identity.mock.calls.length === 3) {
      await writeFile(input().transcriptPath, 'y'.repeat(300000))
    }
  })
  const consume = vi.fn()
  await expect(withSbxTranscriptSnapshot(input(), consume)).rejects.toThrow('changed')
  expect(consume).not.toHaveBeenCalled()
})
it('refuses guest symlinks escaping the account root', async () => {
  const outside = `${root}-outside.jsonl`
  await writeFile(outside, 'outside')
  try {
    await symlink(outside, input().transcriptPath)
    await expect(withSbxTranscriptSnapshot(input(), vi.fn())).rejects.toThrow('outside')
  } finally {
    await rm(outside, { force: true })
  }
})
it('does not publish data without verified guest shutdown', async () => {
  await writeFile(input().transcriptPath, 'data')
  mocks.inspect.mockImplementation(async (_target, _provider, inspect) => {
    await inspect()
    throw new Error('shutdown unproven')
  })
  const consume = vi.fn()
  await expect(withSbxTranscriptSnapshot(input(), consume)).rejects.toThrow('shutdown unproven')
  expect(consume).not.toHaveBeenCalled()
})
it('refuses an identity replacement during a read', async () => {
  await writeFile(input().transcriptPath, 'data')
  mocks.identity.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('identity changed'))
  const consume = vi.fn()
  await expect(withSbxTranscriptSnapshot(input(), consume)).rejects.toThrow('identity changed')
  expect(consume).not.toHaveBeenCalled()
})
