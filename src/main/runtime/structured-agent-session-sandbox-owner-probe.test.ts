import { expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import {
  createStructuredAgentSessionOwnerProbe,
  createStructuredAgentSessionOwnerProbes
} from './structured-agent-session-owner-probe'

it('never treats absence of the transport PID as sandbox provider death', async () => {
  const record = agentSessionRecordFixture()
  record.schemaVersion = 3
  record.location.sandbox = { kind: 'docker-sandbox', id: 'guest-1', name: 'orca-claude' }
  const probe = vi.fn()
  const scan = vi.fn()
  const guestProbe = vi.fn().mockResolvedValue({ outcome: 'indeterminate' })
  const one = createStructuredAgentSessionOwnerProbe('local', probe, scan, guestProbe)
  expect(await one(record)).toMatchObject({ outcome: 'indeterminate' })
  const batch = vi.fn().mockResolvedValue([])
  const results = await createStructuredAgentSessionOwnerProbes('local', batch, one)([record])
  expect(results.get(record.sessionId)).toMatchObject({ outcome: 'indeterminate' })
  expect(batch.mock.calls[0][0].identities).toEqual([])
  record.lease.ownerProcess = null
  expect(await one(record)).toMatchObject({ outcome: 'indeterminate' })
  expect(probe).not.toHaveBeenCalled()
  expect(scan).not.toHaveBeenCalled()
})

it('composes transport and guest evidence during batch recovery', async () => {
  const { probeSbxSessionOwner } = await import('../sbx/sbx-session-owner-probe')
  const record = agentSessionRecordFixture()
  record.schemaVersion = 3
  record.location.sandbox = { kind: 'docker-sandbox', id: 'guest-1', name: 'orca-claude' }
  const transport = vi.fn().mockResolvedValue({ outcome: 'pid-absent' })
  const list = vi
    .fn()
    .mockResolvedValue([
      { id: 'guest-1', name: 'orca-claude', status: 'running', agent: 'claude', workspaces: [] }
    ])
  const one = createStructuredAgentSessionOwnerProbe(
    'local',
    transport,
    vi.fn(),
    (record, hostId, probe) => probeSbxSessionOwner(record, hostId, probe, list)
  )
  const many = createStructuredAgentSessionOwnerProbes('local', vi.fn().mockResolvedValue([]), one)
  expect((await many([record])).get(record.sessionId)).toMatchObject({ outcome: 'indeterminate' })
  list.mockResolvedValue([])
  expect((await many([record])).get(record.sessionId)).toEqual({ outcome: 'pid-absent' })
  expect(transport).toHaveBeenCalledTimes(2)
})
