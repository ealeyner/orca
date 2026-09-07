import { createExecutionExitProof } from '../../shared/child-process/execution-exit-proof'
import { reserveSbxNativeProvider, type SbxNativeTarget } from './sbx-native-reservation'

const inspecting = new Set<string>()
const cleanup = new Map<string, () => Promise<boolean>>()

export async function retrySbxInspectionCleanup(name: string): Promise<void> {
  if (inspecting.has(name)) {
    throw new Error('Sandbox inspection is already in progress.')
  }
  const confirm = cleanup.get(name)
  if (confirm) {
    if (!(await confirm())) {
      throw new Error('Sandbox inspection cleanup is still unverifiable.')
    }
    if (cleanup.get(name) === confirm) {
      cleanup.delete(name)
    }
  }
}

/** Even file reads can start sbx; publish results only after the guest is proven stopped. */
export async function inspectStoppedSbx<T>(
  target: SbxNativeTarget,
  provider: 'claude' | 'codex',
  inspect: () => Promise<T>
): Promise<T> {
  await retrySbxInspectionCleanup(target.name)
  if (inspecting.has(target.name)) {
    throw new Error('Sandbox inspection is already in progress.')
  }
  inspecting.add(target.name)
  try {
    const reservation = await reserveSbxNativeProvider(target, provider)
    const confirm = createExecutionExitProof(reservation.confirmExecutionExit)
    let result: T | undefined
    let failure: unknown
    let failed = false
    try {
      result = await inspect()
    } catch (error) {
      failed = true
      failure = error
    }
    if (!(await confirm())) {
      cleanup.set(target.name, confirm)
      throw new Error('Sandbox inspection ended without sandbox shutdown proof.', {
        cause: failure
      })
    }
    if (failed) {
      throw failure
    }
    return result as T
  } finally {
    inspecting.delete(target.name)
  }
}
