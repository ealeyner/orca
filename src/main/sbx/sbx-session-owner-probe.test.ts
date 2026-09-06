import { expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import { probeSbxSessionOwner } from './sbx-session-owner-probe'

function record() {
  const value = agentSessionRecordFixture()
  value.schemaVersion = 3
  value.location.sandbox = { kind: 'docker-sandbox', name: 'orca-claude', id: 'guest-1' }
  return value
}
const guest = {
  name: 'orca-claude',
  id: 'guest-1',
  agent: 'claude',
  status: 'stopped',
  workspaces: []
}
const absent = async () => ({ outcome: 'pid-absent' as const })

it('requires guest shutdown as well as transport absence', async () => {
  expect(await probeSbxSessionOwner(record(), 'local', absent, async () => [guest])).toEqual({
    outcome: 'pid-absent'
  })
  expect(
    await probeSbxSessionOwner(record(), 'local', absent, async () => [
      { ...guest, status: 'running' }
    ])
  ).toMatchObject({ outcome: 'indeterminate' })
})

it('matches immutable IDs rather than a reused name', async () => {
  expect(
    await probeSbxSessionOwner(record(), 'local', absent, async () => [
      { ...guest, id: 'replacement', status: 'running' }
    ])
  ).toEqual({ outcome: 'pid-absent' })
  expect(
    await probeSbxSessionOwner(record(), 'local', absent, async () => [
      { ...guest, name: 'renamed', status: 'running' }
    ])
  ).toMatchObject({ outcome: 'indeterminate' })
})

it('never probes another execution host locally', async () => {
  const transport = vi.fn()
  const inventory = vi.fn()
  expect(await probeSbxSessionOwner(record(), 'another-host', transport, inventory)).toMatchObject({
    outcome: 'indeterminate'
  })
  expect(transport).not.toHaveBeenCalled()
  expect(inventory).not.toHaveBeenCalled()
})

it('retains the lease on inventory failure or unknown guest state', async () => {
  expect(
    await probeSbxSessionOwner(record(), 'local', absent, async () => {
      throw new Error('offline')
    })
  ).toMatchObject({ outcome: 'indeterminate' })
  expect(
    await probeSbxSessionOwner(record(), 'local', absent, async () => [
      { ...guest, status: 'unknown' }
    ])
  ).toMatchObject({ outcome: 'indeterminate' })
})

it('does not release an unproven transport even when the sandbox has stopped', async () => {
  const inventory = vi.fn().mockResolvedValue([guest])
  expect(
    await probeSbxSessionOwner(
      record(),
      'local',
      async () => ({ outcome: 'identity-matched', matchedOn: ['spawn-token'] }),
      inventory
    )
  ).toMatchObject({ outcome: 'indeterminate' })
  expect(inventory).not.toHaveBeenCalled()
})

it('allows an unused reservation only after checking its guest', async () => {
  const unused = async () => ({ outcome: 'reservation-unused' as const })
  expect(await probeSbxSessionOwner(record(), 'local', unused, async () => [])).toEqual({
    outcome: 'reservation-unused'
  })
  expect(
    await probeSbxSessionOwner(record(), 'local', unused, async () => [
      { ...guest, status: 'running' }
    ])
  ).toMatchObject({ outcome: 'indeterminate' })
})
