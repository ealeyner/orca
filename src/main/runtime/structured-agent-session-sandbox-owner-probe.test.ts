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
  const one = createStructuredAgentSessionOwnerProbe('local', probe, scan)
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
