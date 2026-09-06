import { SbxClient } from './sbx-client'
import { readSbxBinding } from './sbx-bindings'
import type { SbxSandbox } from '../../shared/sbx-types'

export async function listSbxInventory(connectionId?: string): Promise<SbxSandbox[]> {
  const sandboxes = await new SbxClient(connectionId).list()
  return Promise.all(
    sandboxes.map(async (sandbox) => {
      const binding = await readSbxBinding(sandbox.name, connectionId)
      return { ...sandbox, managed: binding?.sandboxId === sandbox.id }
    })
  )
}
