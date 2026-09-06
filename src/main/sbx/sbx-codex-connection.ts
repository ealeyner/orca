import {
  openCodexAppServerConnection,
  type CodexAppServerConnectionHandlers
} from '../codex/codex-app-server-connection'
import { isCodexAppServerHandshakeExitUnprovenError } from '../codex/codex-app-server-handshake-exit-proof'
import { reserveSbxNativeProvider } from './sbx-native-reservation'

/** Called on the execution runtime, never on an SSH client standing in for that runtime. */
export async function openSbxCodexConnection(
  input: { name: string; sandboxId: string; workspace: string; cliArgs?: string[] },
  handlers: CodexAppServerConnectionHandlers = {},
  openConnection = openCodexAppServerConnection
) {
  const reservation = await reserveSbxNativeProvider(input, 'codex')
  try {
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
        confirmExecutionExit: reservation.confirmExecutionExit
      },
      handlers
    )
  } catch (error) {
    // A retained handshake connection owns the slot until a later close proves guest exit.
    if (!isCodexAppServerHandshakeExitUnprovenError(error)) {
      reservation.release()
    }
    throw error
  }
}
