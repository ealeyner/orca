import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { withSbxProviderTranscript } from './sbx-provider-transcript'
const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('./sbx-client', () => ({
  SbxClient: class {
    run = mocks.run
  }
}))
vi.mock('./sbx-lifecycle', () => ({ requireSbxIdentity: async () => ({ id: 'guest' }) }))
vi.mock('./sbx-stopped-inspection', () => ({
  inspectStoppedSbx: async (
    _target: unknown,
    _provider: unknown,
    inspect: () => Promise<unknown>
  ) => inspect()
}))
const id = '12345678-1234-1234-1234-123456789abc'
let root: string
const input = (provider: 'claude' | 'codex') => ({
  target: { name: 'guest', sandboxId: 'guest', workspace: '/work' },
  provider,
  accountHome: root,
  providerSessionId: id
})
async function transcript(path: string, rows: unknown[]) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-guest-provider-test-'))
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
it('discovers a Claude project transcript and proves its branch with the existing reader', async () => {
  await transcript(join(root, 'projects', '-work', `${id}.jsonl`), [
    { type: 'user', uuid: 'parent', parentUuid: null, sessionId: id },
    { type: 'assistant', uuid: 'leaf', parentUuid: 'parent', sessionId: id },
    { type: 'last-prompt', leafUuid: 'leaf', sessionId: id }
  ])
  await withSbxProviderTranscript(
    { ...input('claude'), previousLeafUuid: 'parent' },
    async ({ path, leafUuid }) => {
      expect(leafUuid).toBe('leaf')
      expect(await readFile(path, 'utf8')).toContain('parent')
    }
  )
})
it('discovers Codex dated rollouts and verifies session metadata', async () => {
  await transcript(join(root, 'sessions', '2026', '09', '07', `rollout-date-${id}.jsonl`), [
    { type: 'session_meta', payload: { id } }
  ])
  await withSbxProviderTranscript(input('codex'), async ({ leafUuid }) =>
    expect(leafUuid).toBeNull()
  )
})
it('refuses a correctly named file containing another Codex thread', async () => {
  await transcript(join(root, 'sessions', '2026', '09', '07', `rollout-date-${id}.jsonl`), [
    { type: 'session_meta', payload: { id: 'another-thread' } }
  ])
  const consume = vi.fn()
  await expect(withSbxProviderTranscript(input('codex'), consume)).rejects.toThrow(
    'pinned thread identity'
  )
  expect(consume).not.toHaveBeenCalled()
})
it('refuses a Claude transcript that diverges from the saved leaf', async () => {
  await transcript(join(root, 'projects', '-work', `${id}.jsonl`), [
    { type: 'user', uuid: 'other-leaf', parentUuid: null, sessionId: id },
    { type: 'last-prompt', leafUuid: 'other-leaf', sessionId: id }
  ])
  await expect(
    withSbxProviderTranscript({ ...input('claude'), previousLeafUuid: 'missing-leaf' }, vi.fn())
  ).rejects.toThrow('previous cursor')
})
it('refuses ambiguous transcript locations', async () => {
  for (const project of ['one', 'two']) {
    await transcript(join(root, 'projects', project, `${id}.jsonl`), [])
  }
  await expect(withSbxProviderTranscript(input('claude'), vi.fn())).rejects.toThrow('ambiguous')
})
it('reports missing transcripts instead of consulting host account paths', async () => {
  await expect(withSbxProviderTranscript(input('codex'), vi.fn())).rejects.toThrow('not found')
})
