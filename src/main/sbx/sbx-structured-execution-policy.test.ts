import { expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import { assertSbxStructuredExecutionAllowed } from './sbx-structured-execution-policy'
const read = vi.hoisted(() => vi.fn())
vi.mock('./sbx-bindings', () => ({ readSbxBinding: read }))
function fixture() {
  const record = agentSessionRecordFixture()
  record.schemaVersion = 3
  record.location.sandbox = { kind: 'docker-sandbox', id: 'guest-1', name: 'native-one' }
  return record
}
function binding() {
  const record = fixture()
  return {
    name: 'native-one',
    sandboxId: 'guest-1',
    agent: 'claude',
    connectionId: null,
    paneIdentity: `native:${record.sessionId}`,
    nativeAccountHome: record.accountHome
  }
}
it('never launches an unbound host session while sandbox mode is enabled', async () => {
  await expect(
    assertSbxStructuredExecutionAllowed(agentSessionRecordFixture(), { enabled: true })
  ).rejects.toThrow('outside a sandbox')
})
it('keeps existing sessions pinned to the guest after sandbox defaults are disabled', async () => {
  read.mockResolvedValue(binding())
  await expect(
    assertSbxStructuredExecutionAllowed(fixture(), { enabled: false })
  ).resolves.toBeUndefined()
  expect(read).toHaveBeenCalledWith('native-one')
})
it.each([
  null,
  { ...binding(), sandboxId: 'replacement' },
  { ...binding(), paneIdentity: 'another-session' },
  { ...binding(), connectionId: 'remote' },
  { ...binding(), nativeAccountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/other' } }
])('refuses missing or conflicting native bindings %#', async (value) => {
  read.mockResolvedValue(value)
  await expect(assertSbxStructuredExecutionAllowed(fixture(), { enabled: true })).rejects.toThrow(
    'binding could not be verified'
  )
})
it('enforces disabled-agent policy when a saved guest session resumes', async () => {
  await expect(
    assertSbxStructuredExecutionAllowed(fixture(), {
      enabled: true,
      agents: { claude: { enabled: false, denyNetwork: [], workspaces: [], staticMcp: [] } }
    })
  ).rejects.toThrow('disabled')
})
