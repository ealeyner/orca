import { posix } from 'node:path'
import type {
  AgentSessionAccountHome,
  AgentSessionExecutionLocation
} from '../../shared/agent-session-record'
import {
  DEFAULT_SBX_POLICY,
  SbxLaunchPolicySchema,
  type SbxLaunchPolicy,
  type SbxSettings
} from '../../shared/sbx-types'
import { ensureSbxAgentSandbox, sandboxNameForPane } from './sbx-agent-sandbox'
import { readSbxBinding, saveSbxBinding } from './sbx-bindings'
import { SbxClient } from './sbx-client'
import { requireSbxIdentity, stopSbxExecution } from './sbx-lifecycle'
import { inspectStoppedSbx, retrySbxInspectionCleanup } from './sbx-stopped-inspection'

type PreparedNativeSandbox = {
  sandbox: NonNullable<AgentSessionExecutionLocation['sandbox']>
  accountHome: AgentSessionAccountHome
}
const pending = new Map<string, { workspace: string; promise: Promise<PreparedNativeSandbox> }>()
const ACCOUNT_ROOT_PROBE = `const path=require('path'),os=require('os');
const agent=process.argv[1];
const variable=agent==='claude'?'CLAUDE_CONFIG_DIR':'CODEX_HOME';
console.log(JSON.stringify({variable,path:process.env[variable]||path.join(os.homedir(),agent==='claude'?'.claude':'.codex')}));`

/** Runs on the owning runtime; creation retries reuse the pinned guest account without stopping a live session. */
export async function prepareSbxNativeSession(input: {
  sessionId: string
  provider: 'claude' | 'codex'
  workspace: string
  settings: SbxSettings
}): Promise<PreparedNativeSandbox> {
  const identity = `native:${input.sessionId}`
  const name = sandboxNameForPane(input.provider, identity)
  if (!input.settings.enabled) {
    throw new Error('Sandbox execution is not enabled.')
  }
  const policy = SbxLaunchPolicySchema.parse(
    input.settings.agents?.[input.provider] ?? DEFAULT_SBX_POLICY
  )
  if (!policy.enabled) {
    throw new Error(`${input.provider} is disabled by the sandbox launch policy.`)
  }
  let entry = pending.get(name)
  if (entry && entry.workspace !== input.workspace) {
    throw new Error('Native session workspace changed during preparation.')
  }
  if (!entry) {
    entry = { workspace: input.workspace, promise: prepare({ ...input, identity, name, policy }) }
    pending.set(name, entry)
  }
  try {
    return await entry.promise
  } finally {
    if (pending.get(name) === entry) {
      pending.delete(name)
    }
  }
}

async function prepare(
  input: Parameters<typeof prepareSbxNativeSession>[0] & {
    identity: string
    name: string
    policy: SbxLaunchPolicy
  }
): Promise<PreparedNativeSandbox> {
  const policy = input.policy
  await retrySbxInspectionCleanup(input.name)
  const prior = await readSbxBinding(input.name)
  if (prior?.nativeAccountHome) {
    if (
      prior.paneIdentity !== input.identity ||
      prior.agent !== input.provider ||
      prior.workspace !== input.workspace ||
      prior.connectionId !== null ||
      prior.nativeAccountHome.variable !==
        (input.provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME')
    ) {
      throw new Error('Native sandbox binding does not match this session.')
    }
    const guest = await requireSbxIdentity(new SbxClient(), input.name, prior.sandboxId)
    if (guest.agent !== input.provider || !guest.workspaces.includes(input.workspace)) {
      throw new Error('Native sandbox identity conflicts with its workspace.')
    }
    return {
      sandbox: { kind: 'docker-sandbox', id: guest.id, name: guest.name },
      accountHome: prior.nativeAccountHome
    }
  }
  const created = await ensureSbxAgentSandbox({
    name: input.name,
    agent: input.provider,
    sandboxAgent: input.provider,
    workspace: input.workspace,
    paneIdentity: input.identity,
    policy
  })
  const binding = await readSbxBinding(input.name)
  if (
    !binding ||
    binding.paneIdentity !== input.identity ||
    binding.agent !== input.provider ||
    binding.workspace !== input.workspace ||
    binding.connectionId !== null
  ) {
    throw new Error('Native sandbox binding does not match this session.')
  }
  const client = new SbxClient()
  const guest = await requireSbxIdentity(client, input.name, binding.sandboxId)
  const sandbox = { kind: 'docker-sandbox' as const, id: guest.id, name: guest.name }
  const variable = input.provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'
  if (binding.nativeAccountHome) {
    if (binding.nativeAccountHome.variable !== variable) {
      throw new Error('Native sandbox account pin conflicts with its provider.')
    }
    return { sandbox, accountHome: binding.nativeAccountHome }
  }
  if (created) {
    await stopSbxExecution({ name: guest.name, sandboxId: guest.id })
  }
  const accountHome = await inspectStoppedSbx(
    { name: guest.name, sandboxId: guest.id, workspace: input.workspace },
    input.provider,
    async (): Promise<AgentSessionAccountHome> => {
      const result = JSON.parse(
        await client.run(
          ['exec', '--', guest.name, 'node', '-e', ACCOUNT_ROOT_PROBE, input.provider],
          10_000
        )
      )
      if (
        result.variable !== variable ||
        typeof result.path !== 'string' ||
        !posix.isAbsolute(result.path) ||
        result.path.length > 4096 ||
        /[\0\r\n]/.test(result.path)
      ) {
        throw new Error('Guest account root could not be verified.')
      }
      return { variable, path: result.path }
    }
  )
  await saveSbxBinding({ ...binding, nativeAccountHome: accountHome })
  return { sandbox, accountHome }
}
