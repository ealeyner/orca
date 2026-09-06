import { SbxClient } from './sbx-client'
import type { SbxSandbox } from '../../shared/sbx-types'

export async function requireSbxIdentity(
  client: SbxClient,
  name: string,
  sandboxId: string
): Promise<SbxSandbox> {
  const sandbox = (await client.list()).find((entry) => entry.name === name)
  if (!sandbox || sandbox.id !== sandboxId) {
    throw new Error('Sandbox identity changed. Refresh before retrying this operation.')
  }
  return sandbox
}

export async function changeSbxLifecycle(input: {
  name: string
  sandboxId: string
  action: 'start' | 'stop' | 'remove'
  connectionId?: string
}): Promise<void> {
  const client = new SbxClient(input.connectionId)
  const sandbox = await requireSbxIdentity(client, input.name, input.sandboxId)
  if (input.action === 'stop' && sandbox.status === 'stopped') {
    return
  }
  if (input.action === 'start' && sandbox.status === 'running') {
    return
  }
  const argv =
    input.action === 'start'
      ? ['run', '--detached', '--name', input.name]
      : input.action === 'stop'
        ? ['stop', input.name]
        : ['rm', '--force', input.name]
  await client.run(argv, 300_000)
  const remaining = await client.list()
  const target = remaining.find((entry) => entry.id === input.sandboxId)
  if (input.action === 'remove' && target) {
    throw new Error('Sandbox removal is unverifiable. Refresh before retrying.')
  }
  if (input.action === 'stop' && target && target.status !== 'stopped') {
    throw new Error('Sandbox exit is unverifiable. The agent may still be running.')
  }
  if (input.action === 'start' && !target) {
    throw new Error('Sandbox startup is unverifiable. Refresh before retrying.')
  }
}

/** Absence of the immutable ID proves exit even if its old name has been reused. */
export async function stopSbxExecution(input: { name: string; sandboxId: string }): Promise<void> {
  const remaining = await new SbxClient().list()
  if (!remaining.some((sandbox) => sandbox.id === input.sandboxId)) {
    return
  }
  await changeSbxLifecycle({ ...input, action: 'stop' })
}
