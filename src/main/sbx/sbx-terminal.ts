import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { readSbxBinding } from './sbx-bindings'
import {
  buildShellCommandFromArgv,
  tokenizeStartupCommand
} from '../../shared/tui-agent-startup-shell'
import { getRegisteredSshState } from '../ssh/ssh-target-registry'
import { SbxClient } from './sbx-client'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

export async function resolveSbxTerminalLaunch(
  runtime: OrcaRuntimeService,
  name: string,
  mode: 'shell' | 'agent',
  connectionId?: string
) {
  const sandbox = (await new SbxClient(connectionId).list()).find((s) => s.name === name)
  if (!sandbox) {
    throw new Error('Sandbox no longer exists. Refresh the list.')
  }
  const binding = await readSbxBinding(name, connectionId)
  if (binding && binding.sandboxId !== sandbox.id) {
    throw new Error('Sandbox identity changed. Refresh and inspect it before attaching.')
  }
  const agent = binding?.agent ?? sandbox.agent
  if (mode === 'agent' && runtime.getClientSettings().sbx?.agents?.[agent]?.enabled === false) {
    throw new Error(`${agent} is disabled by the sandbox launch policy.`)
  }
  const hostId = connectionId ? `ssh:${connectionId}` : 'local'
  const { worktrees } = await runtime.listManagedWorktrees(undefined, 1000)
  const workspace = worktrees.find(
    (w) => sandbox.workspaces.includes(w.path) && (w.hostId ?? 'local') === hostId
  )
  if (!workspace) {
    throw new Error(
      'Open this sandbox workspace in Orca on its owning host (including its SSH host) before opening a terminal.'
    )
  }
  const platform = connectionId
    ? getRegisteredSshState(connectionId)?.remotePlatform
    : process.platform
  if (!platform) {
    throw new Error('Sandbox host is unverifiable. Reconnect before opening a terminal.')
  }
  const binary = connectionId ? 'sbx' : process.env.ORCA_SBX_BINARY || 'sbx'
  let argv =
    mode === 'shell' ? [binary, 'exec', '-it', name, 'bash'] : [binary, 'run', '--name', name]
  if (mode === 'agent' && binding && agent !== sandbox.agent) {
    const config = TUI_AGENT_CONFIG[agent as keyof typeof TUI_AGENT_CONFIG]
    const parsed = config && tokenizeStartupCommand(config.launchCmd, 'posix')
    if (!parsed?.ok) {
      throw new Error('This sandbox agent is no longer configured in Orca.')
    }
    argv = [binary, 'exec', '-it', '-w', binding.workspace, name, ...parsed.tokens]
  }
  return {
    worktreeId: workspace.id,
    connectionId: connectionId ?? null,
    command: buildShellCommandFromArgv(argv, platform === 'win32' ? 'powershell' : 'posix'),
    cwd: sandbox.workspaces[0],
    title: `${name} · ${mode === 'shell' ? 'Shell' : agent}`
  }
}
