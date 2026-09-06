import { randomUUID } from 'node:crypto'
import { runProcess } from '../../shared/child-process/run-process'
import { getActiveMultiplexer } from '../ssh/ssh-target-registry'
import { SbxCreateSchema, SbxInventorySchema, type SbxCreate } from '../../shared/sbx-types'

export function sbxCreateArgs(input: SbxCreate): string[] {
  const p = SbxCreateSchema.parse(input)
  const args = ['create', '--name', p.name]
  for (const [key, value] of [
    ['profile', p.profile],
    ['template', p.template],
    ['cpus', p.cpus],
    ['memory', p.memory]
  ] as const) {
    if (value !== undefined) {
      args.push(`--${key}`, String(value))
    }
  }
  for (const resource of p.denyNetwork) {
    args.push('--deny-network', resource)
  }
  if (p.staticMcp.length) {
    args.push('--static-mcp', p.staticMcp.join(','))
  }
  args.push(
    p.agent,
    '--',
    p.workspace,
    ...p.workspaces.map((w) => `${w.path}${w.readOnly ? ':ro' : ''}`)
  )
  return args
}

export class SbxClient {
  constructor(readonly connectionId?: string) {}

  async run(args: string[], timeoutMs = 30_000, acceptedExitCodes = [0]): Promise<string> {
    if (this.connectionId) {
      const mux = getActiveMultiplexer(this.connectionId)
      if (!mux) {
        throw new Error('Sandbox host is unverifiable. Reconnect before retrying.')
      }
      const result = (await mux.request(
        'agent.execNonInteractive',
        {
          binary: 'sbx',
          args,
          cwd: '.',
          timeoutMs,
          operation: `sbx:${args[0]}:${randomUUID()}`
        },
        { timeoutMs: timeoutMs + 5_000 }
      )) as {
        stdout: string
        stderr: string
        exitCode: number | null
        timedOut: boolean
        spawnError?: string
        canceled?: boolean
      }
      if (
        !acceptedExitCodes.includes(result.exitCode ?? -1) ||
        result.timedOut ||
        result.canceled ||
        result.spawnError
      ) {
        throw new Error(
          result.stderr || result.spawnError || 'Sandbox operation outcome is unverifiable.'
        )
      }
      return result.stdout
    }
    const result = await runProcess({
      program: process.env.ORCA_SBX_BINARY || 'sbx',
      args,
      timeoutMs,
      maxOutputBytes: 2 * 1024 * 1024
    })
    if (
      !acceptedExitCodes.includes(result.code ?? -1) ||
      result.timedOut ||
      result.outputTruncated
    ) {
      throw new Error(
        result.stderr.trim() ||
          'Sandbox operation outcome is unverifiable. Check Docker Sandboxes and retry.'
      )
    }
    return result.stdout
  }

  async list() {
    return SbxInventorySchema.parse(JSON.parse(await this.run(['ls', '--json']))).sandboxes
  }

  async create(input: SbxCreate) {
    await this.run(sbxCreateArgs(input), 300_000)
    const sandbox = (await this.list()).find((s) => s.name === input.name)
    if (!sandbox) {
      throw new Error('Sandbox creation could not be verified. Refresh before retrying.')
    }
    return sandbox
  }
}
