import { describe, expect, it } from 'vitest'
import {
  agentSessionScopeKey,
  isAgentSessionExecutionLocation,
  isAgentSessionRecord
} from './agent-session-record'
import { agentSessionRecordFixture } from './agent-session-record.test-fixture'

function sandboxRecord() {
  const record = agentSessionRecordFixture()
  record.schemaVersion = 3
  record.location.sandbox = { kind: 'docker-sandbox', id: 'guest-1', name: 'orca-claude' }
  return record
}

describe('sandbox durable identity', () => {
  it('requires the sandbox version and preserves host record compatibility', () => {
    expect(isAgentSessionRecord(agentSessionRecordFixture())).toBe(true)
    const record = sandboxRecord()
    expect(isAgentSessionRecord(record)).toBe(true)
    expect(isAgentSessionRecord({ ...record, schemaVersion: 2 })).toBe(false)
    expect(isAgentSessionRecord({ ...agentSessionRecordFixture(), schemaVersion: 3 })).toBe(false)
  })

  it('separates host and replacement guests even when their workspace and name match', () => {
    const host = agentSessionRecordFixture().location
    const guest = sandboxRecord().location
    expect(agentSessionScopeKey(guest)).not.toBe(agentSessionScopeKey(host))
    expect(agentSessionScopeKey(guest)).not.toBe(
      agentSessionScopeKey({
        ...guest,
        sandbox: { ...guest.sandbox!, id: 'replacement' }
      })
    )
    expect(agentSessionScopeKey(host)).toBe('local\0\0workspace-1')
  })

  it('rejects malformed guest identities and namespace separator injection', () => {
    const location = sandboxRecord().location
    for (const sandbox of [
      null,
      {},
      { ...location.sandbox, id: '' },
      { ...location.sandbox, id: 'a\0b' },
      { ...location.sandbox, name: '--other' }
    ]) {
      expect(isAgentSessionExecutionLocation({ ...location, sandbox })).toBe(false)
    }
    expect(isAgentSessionExecutionLocation({ ...location, wslDistro: 'Ubuntu' })).toBe(false)
    expect(
      isAgentSessionExecutionLocation({ ...location, workspaceId: 'x\0docker-sandbox\0y' })
    ).toBe(false)
  })
})
