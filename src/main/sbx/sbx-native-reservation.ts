import { createExecutionExitProof } from '../../shared/child-process/execution-exit-proof'
import { SbxClient } from './sbx-client'
import { requireSbxIdentity, stopSbxExecution } from './sbx-lifecycle'

const active = new Map<string, symbol>()
export type SbxNativeTarget = { name: string; sandboxId: string; workspace: string }

export async function reserveSbxNativeProvider(
  input: SbxNativeTarget,
  provider: 'claude' | 'codex'
) {
  if (active.has(input.sandboxId)) {
    throw new Error('This sandbox already has a native provider connection.')
  }
  const generation = Symbol('native-provider')
  active.set(input.sandboxId, generation)
  const release = () => {
    if (active.get(input.sandboxId) === generation) {
      active.delete(input.sandboxId)
    }
  }
  try {
    const sandbox = await requireSbxIdentity(new SbxClient(), input.name, input.sandboxId)
    if (sandbox.agent !== provider || !sandbox.workspaces.includes(input.workspace)) {
      throw new Error(`Sandbox identity conflicts with the native ${provider} workspace.`)
    }
    if (sandbox.status !== 'stopped') {
      throw new Error('Stop the sandbox before opening a new native provider connection.')
    }
    return {
      release,
      confirmExecutionExit: createExecutionExitProof(async () => {
        if (active.get(input.sandboxId) !== generation) {
          return false
        }
        await stopSbxExecution({ name: input.name, sandboxId: input.sandboxId })
        release()
        return true
      })
    }
  } catch (error) {
    release()
    throw error
  }
}
