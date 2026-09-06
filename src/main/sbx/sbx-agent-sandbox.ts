import { createHash } from 'node:crypto'
import type { SBX_AGENTS, SbxLaunchPolicy } from '../../shared/sbx-types'
import { SbxClient } from './sbx-client'
import { readSbxBinding, saveSbxBinding } from './sbx-bindings'

const pending = new Map<string, Promise<void>>()

export function sandboxNameForPane(agent: string, identity: string): string {
  return `orca-${agent}-${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`
}

export async function ensureSbxAgentSandbox(input: {
  name: string
  agent: string
  sandboxAgent: (typeof SBX_AGENTS)[number]
  workspace: string
  paneIdentity: string
  policy: SbxLaunchPolicy
  connectionId?: string | null
}): Promise<void> {
  const { name, agent, sandboxAgent, workspace, paneIdentity, policy, connectionId } = input
  const client = new SbxClient(connectionId ?? undefined)
  const key = `${connectionId ?? 'local'}:${name}`
  let provisioning = pending.get(key)
  if (!provisioning) {
    provisioning = (async () => {
      const existing = (await client.list()).find((s) => s.name === name)
      if (existing) {
        const binding = await readSbxBinding(name, connectionId)
        if (!binding || binding.sandboxId !== existing.id) {
          throw new Error(
            'Sandbox ownership could not be verified. Inspect this sandbox before starting a new agent pane.'
          )
        }
        if (existing.agent !== sandboxAgent || !existing.workspaces.includes(workspace)) {
          throw new Error('Sandbox identity conflicts with this agent workspace.')
        }
        return
      }
      const created = await client.create({
        ...policy,
        name,
        agent: sandboxAgent as (typeof SBX_AGENTS)[number],
        workspace
      })
      await saveSbxBinding({
        name,
        sandboxId: created.id,
        agent,
        workspace,
        paneIdentity,
        connectionId: connectionId ?? null
      })
    })()
    pending.set(key, provisioning)
  }
  try {
    await provisioning
  } finally {
    if (pending.get(key) === provisioning) {
      pending.delete(key)
    }
  }
}
