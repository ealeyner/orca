import {
  isProvenDeadProbe,
  type AgentSessionOwnerProbe
} from '../../shared/agent-session-lease-adjudication'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { SbxClient } from './sbx-client'

/** Both the transport and its pinned guest must be absent before another writer is admitted. */
export async function probeSbxSessionOwner(
  record: AgentSessionRecord,
  hostId: string,
  probeTransport: () => Promise<AgentSessionOwnerProbe>,
  list = () => new SbxClient().list()
): Promise<AgentSessionOwnerProbe> {
  const unknown = (reason: string): AgentSessionOwnerProbe => ({ outcome: 'indeterminate', reason })
  const sandbox = record.location.sandbox
  if (!sandbox || record.location.executionHostId !== hostId) {
    return unknown('sandbox execution host is unverifiable from this runtime')
  }
  try {
    const transport = await probeTransport()
    if (!isProvenDeadProbe(transport) && transport.outcome !== 'reservation-unused') {
      return unknown('sandbox transport exit is unverifiable')
    }
    const guest = (await list()).find((entry) => entry.id === sandbox.id)
    if (guest && guest.status !== 'stopped') {
      return unknown('sandbox provider may still be running')
    }
    return transport
  } catch {
    return unknown('sandbox ownership is unverifiable; reconnect and retry')
  }
}
