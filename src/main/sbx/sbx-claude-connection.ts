import { spawnProcess } from '../../shared/child-process/run-process'
import {
  openClaudeStreamJsonConnection,
  type ClaudeStreamJsonConnectionHandlers
} from '../claude/claude-stream-json-connection'
import {
  createClaudeChildTreeReaper,
  proveClaudeChildExit
} from '../claude/claude-agent-sdk-exit-proof'
import {
  CLAUDE_STRUCTURED_BASE_OPTIONS,
  type ClaudeStructuredSdkOptions
} from '../claude/claude-structured-launch-resolution'
import { reserveSbxNativeProvider, type SbxNativeTarget } from './sbx-native-reservation'

export class SbxClaudeStartUnprovenError extends Error {
  constructor(
    readonly pid: number | undefined,
    readonly retryShutdown: () => Promise<boolean>,
    cause: unknown
  ) {
    super('Claude sandbox startup failed without execution-exit proof.', { cause })
    this.name = 'SbxClaudeStartUnprovenError'
  }
}

export async function openSbxClaudeConnection(
  input: SbxNativeTarget & {
    options?: ClaudeStructuredSdkOptions
    claudeConfigDir?: string
    transportEnv?: Record<string, string>
  },
  handlers: ClaudeStreamJsonConnectionHandlers = {},
  openConnection = openClaudeStreamJsonConnection,
  spawnImpl = spawnProcess
) {
  const reservation = await reserveSbxNativeProvider(input, 'claude')
  const attempt: {
    child: ReturnType<typeof spawnProcess> | null
    rollback: (() => Promise<boolean>) | null
  } = { child: null, rollback: null }
  try {
    return await openConnection(
      {
        pathToClaudeCodeExecutable: 'claude',
        cwd: input.workspace,
        options: input.options ?? CLAUDE_STRUCTURED_BASE_OPTIONS,
        usesHostCredentials: false,
        ...(input.transportEnv ? { env: input.transportEnv } : {}),
        confirmExecutionExit: reservation.confirmExecutionExit
      },
      handlers,
      (spec) => {
        if (spec.program !== 'claude') {
          throw new Error('The sandbox SDK must execute the guest Claude binary directly.')
        }
        const owned = spawnImpl({
          ...spec,
          program: process.env.ORCA_SBX_BINARY || 'sbx',
          args: [
            'exec',
            '-i',
            '-w',
            input.workspace,
            '--',
            input.name,
            ...(input.claudeConfigDir ? ['env', `CLAUDE_CONFIG_DIR=${input.claudeConfigDir}`] : []),
            'claude',
            ...(spec.args ?? [])
          ]
        })
        attempt.child = owned
        let settled = owned.exitCode !== null || owned.signalCode !== null
        let resolveExit!: () => void
        const exitPromise = new Promise<void>((resolve) => {
          resolveExit = resolve
        })
        const settle = () => {
          settled = true
          resolveExit()
        }
        owned.once('exit', settle)
        owned.once('close', settle)
        if (settled) {
          resolveExit()
        }
        const tree = createClaudeChildTreeReaper(owned, { exited: () => settled })
        const capture = tree.capture().catch(() => {})
        attempt.rollback = async () => {
          await capture
          const localExit =
            (owned.pid === undefined && settled) ||
            (await proveClaudeChildExit({ child: owned, exitPromise, exited: () => settled, tree }))
          return localExit && (await reservation.confirmExecutionExit())
        }
        return owned
      }
    )
  } catch (error) {
    if (!attempt.child || !attempt.rollback) {
      reservation.release()
      throw error
    }
    const retry = async () => {
      try {
        return await attempt.rollback!()
      } catch {
        return false
      }
    }
    if (!(await retry())) {
      throw new SbxClaudeStartUnprovenError(attempt.child.pid, retry, error)
    }
    throw error
  }
}
