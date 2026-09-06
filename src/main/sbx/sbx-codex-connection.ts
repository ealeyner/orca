import {
  openCodexAppServerConnection,
  type CodexAppServerConnectionHandlers
} from '../codex/codex-app-server-connection'
import { isCodexAppServerHandshakeExitUnprovenError } from '../codex/codex-app-server-handshake-exit-proof'
import { SbxClient } from './sbx-client'
import { stopSbxExecution, requireSbxIdentity } from './sbx-lifecycle'

const active = new Set<string>()

/** Called on the execution runtime, never on an SSH client standing in for that runtime. */
export async function openSbxCodexConnection(
  input: { name: string; sandboxId: string; workspace: string; cliArgs?: string[] },
  handlers: CodexAppServerConnectionHandlers = {},
  openConnection = openCodexAppServerConnection
) {
  if (active.has(input.sandboxId)) {
    throw new Error('This sandbox already has a native provider connection.')
  }
  active.add(input.sandboxId)
  try {
    const sandbox = await requireSbxIdentity(new SbxClient(), input.name, input.sandboxId)
    if (sandbox.agent !== 'codex' || !sandbox.workspaces.includes(input.workspace)) {
      throw new Error('Sandbox identity conflicts with the native Codex workspace.')
    }
    if (sandbox.status !== 'stopped') {
      throw new Error('Stop the sandbox before opening a new native provider connection.')
    }
    return await openConnection(
      {
        command: process.env.ORCA_SBX_BINARY || 'sbx',
        args: [
          'exec',
          '-i',
          '-w',
          input.workspace,
          '--',
          input.name,
          'codex',
          ...(input.cliArgs ?? []),
          'app-server'
        ],
        confirmExecutionExit: async () => {
          await stopSbxExecution({ name: input.name, sandboxId: input.sandboxId })
          active.delete(input.sandboxId)
          return true
        }
      },
      handlers
    )
  } catch (error) {
    // A retained handshake connection owns the slot until a later close proves guest exit.
    if (!isCodexAppServerHandshakeExitUnprovenError(error)) {
      active.delete(input.sandboxId)
    }
    throw error
  }
}
