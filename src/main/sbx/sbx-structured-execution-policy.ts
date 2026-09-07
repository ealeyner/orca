import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { SbxSettings } from '../../shared/sbx-types'
import { readSbxBinding } from './sbx-bindings'

export async function assertSbxStructuredExecutionAllowed(
  record: AgentSessionRecord,
  settings?: SbxSettings
): Promise<void> {
  const sandbox = record.location.sandbox
  if (!sandbox) {
    if (settings?.enabled) {
      throw new Error(
        'Sandbox execution is enabled; this host session cannot launch outside a sandbox.'
      )
    }
    return
  }
  if (settings?.agents?.[record.provider]?.enabled === false) {
    throw new Error(`${record.provider} is disabled by the sandbox launch policy.`)
  }
  if (record.location.executionHostId !== 'local' || record.location.wslDistro !== null) {
    throw new Error('Sandbox session execution belongs to another runtime.')
  }
  const binding = await readSbxBinding(sandbox.name)
  if (
    !binding ||
    binding.sandboxId !== sandbox.id ||
    binding.agent !== record.provider ||
    binding.paneIdentity !== `native:${record.sessionId}` ||
    binding.connectionId !== null ||
    binding.nativeAccountHome?.variable !== record.accountHome.variable ||
    binding.nativeAccountHome.path !== record.accountHome.path
  ) {
    throw new Error('Native session sandbox or account binding could not be verified.')
  }
}
