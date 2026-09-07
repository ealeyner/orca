import { expect, it, vi } from 'vitest'
import type { SbxClient } from './sbx-client'
import {
  readSbxClaudeStartupIdentity,
  SBX_CLAUDE_STARTUP_PROBE
} from './sbx-claude-startup-identity'

const sessionId = '431efb68-09b9-4b99-9175-a28c6b730980'
const input = {
  name: 'native',
  sandboxId: 'guest-1',
  workspace: '/project',
  claudeConfigDir: '/guest/.claude',
  initialization: { pid: 252 }
}
const guest = {
  name: 'native',
  id: 'guest-1',
  agent: 'claude',
  status: 'running',
  workspaces: ['/project']
}
const proof = {
  before: '71',
  after: '71',
  domain: 'linux::pid:[123]',
  record: { pid: 252, sessionId, cwd: '/project', procStart: '71', pidDomain: 'linux::pid:[123]' }
}
function client(value: unknown = proof) {
  return {
    list: vi.fn().mockResolvedValue([guest]),
    run: vi.fn().mockResolvedValue(JSON.stringify(value))
  }
}

it('verifies only the initialized PID in the pinned guest account', async () => {
  const c = client()
  expect(await readSbxClaudeStartupIdentity(input, c as unknown as SbxClient)).toBe(sessionId)
  expect(c.run).toHaveBeenCalledWith(
    ['exec', '--', 'native', 'node', '-e', SBX_CLAUDE_STARTUP_PROBE, '/guest/.claude', '252'],
    5000
  )
  expect(c.list).toHaveBeenCalledTimes(2)
})

it.each([
  null,
  { ...proof, before: '70' },
  { ...proof, after: '72' },
  { ...proof, record: { ...proof.record, pid: 253 } },
  { ...proof, record: { ...proof.record, procStart: '70' } },
  { ...proof, record: { ...proof.record, pidDomain: 'linux::pid:[456]' } },
  { ...proof, record: { ...proof.record, cwd: '/another' } },
  { ...proof, record: { ...proof.record, sessionId: 'not-a-session' } }
])('rejects stale, incomplete, or mismatched guest evidence %#', async (value) => {
  expect(
    await readSbxClaudeStartupIdentity(input, client(value) as unknown as SbxClient)
  ).toBeNull()
})

it('does not start a stopped guest to look for historical metadata', async () => {
  const c = client()
  c.list.mockResolvedValue([{ ...guest, status: 'stopped' }])
  expect(await readSbxClaudeStartupIdentity(input, c as unknown as SbxClient)).toBeNull()
  expect(c.run).not.toHaveBeenCalled()
})

it('refuses a replacement sandbox before and after the metadata read', async () => {
  const c = client()
  c.list.mockResolvedValue([{ ...guest, id: 'replacement' }])
  await expect(readSbxClaudeStartupIdentity(input, c as unknown as SbxClient)).rejects.toThrow(
    'identity changed'
  )
  expect(c.run).not.toHaveBeenCalled()
  c.list.mockResolvedValueOnce([guest])
  await expect(readSbxClaudeStartupIdentity(input, c as unknown as SbxClient)).rejects.toThrow(
    'identity changed'
  )
})

it('preserves missing PID compatibility and fails closed on probe errors', async () => {
  const c = client()
  expect(
    await readSbxClaudeStartupIdentity({ ...input, initialization: {} }, c as unknown as SbxClient)
  ).toBeNull()
  expect(c.list).not.toHaveBeenCalled()
  c.run.mockRejectedValue(new Error('timeout'))
  await expect(readSbxClaudeStartupIdentity(input, c as unknown as SbxClient)).rejects.toThrow(
    'timeout'
  )
})

it('does not launch a late metadata probe after the SDK connection closes', async () => {
  const c = client()
  let active = true
  c.list.mockImplementation(async () => {
    active = false
    return [guest]
  })
  expect(
    await readSbxClaudeStartupIdentity(
      { ...input, isActive: () => active },
      c as unknown as SbxClient
    )
  ).toBeNull()
  expect(c.run).not.toHaveBeenCalled()
})
