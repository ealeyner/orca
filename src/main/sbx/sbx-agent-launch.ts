import { randomUUID } from 'node:crypto'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { PtySpawnOptions } from '../providers/types'
import { SBX_AGENTS, DEFAULT_SBX_POLICY, SbxLaunchPolicySchema } from '../../shared/sbx-types'
import {
  buildShellCommandFromArgv,
  tokenizeStartupCommand,
  type AgentStartupShell
} from '../../shared/tui-agent-startup-shell'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { getRegisteredSshState } from '../ssh/ssh-target-registry'
import { ensureSbxAgentSandbox, sandboxNameForPane } from './sbx-agent-sandbox'
export { sandboxNameForPane } from './sbx-agent-sandbox'

export async function prepareSbxAgentLaunch(
  options: PtySpawnOptions,
  settings: Pick<GlobalSettings, 'sbx'> | undefined,
  connectionId?: string | null,
  originalCommand = options.command
): Promise<void> {
  const agent = options.launchAgent
  if (!agent || !settings?.sbx?.enabled) {
    return
  }
  const policy = SbxLaunchPolicySchema.parse(settings.sbx.agents?.[agent] ?? DEFAULT_SBX_POLICY)
  if (!policy.enabled) {
    throw new Error(`${agent} is disabled by the sandbox launch policy.`)
  }
  const nativeAgent = (SBX_AGENTS as readonly string[]).includes(agent)
  if (!nativeAgent && !policy.template) {
    throw new Error(
      `Docker Sandboxes does not provide ${agent}. Select a template containing this agent in Agent access defaults.`
    )
  }
  const sandboxAgent = nativeAgent ? agent : 'shell'
  if (!options.cwd) {
    throw new Error('Choose a workspace before starting a sandbox agent.')
  }
  if (options.shellOverride && /wsl/i.test(options.shellOverride)) {
    throw new Error('Choose the native host runtime to launch Docker Sandboxes.')
  }
  const platform = connectionId
    ? getRegisteredSshState(connectionId)?.remotePlatform
    : process.platform
  if (!platform) {
    throw new Error('Sandbox host is unverifiable. Reconnect before starting an agent.')
  }
  const shell: AgentStartupShell =
    platform !== 'win32'
      ? 'posix'
      : /cmd(?:\.exe)?$/i.test(options.shellOverride ?? '')
        ? 'cmd'
        : 'powershell'
  const parsed = tokenizeStartupCommand(originalCommand ?? agent, shell)
  const expected = tokenizeStartupCommand(TUI_AGENT_CONFIG[agent].launchCmd, 'posix')
  if (!parsed.ok || !expected.ok || parsed.tokens[0] !== expected.tokens[0]) {
    throw new Error(
      'Sandbox agents require a direct agent command. Remove the custom host command in Agents settings.'
    )
  }
  const name = sandboxNameForPane(
    agent,
    `${options.worktreeId ?? options.cwd}:${options.paneKey ?? options.tabId ?? options.sessionId ?? randomUUID()}`
  )
  await ensureSbxAgentSandbox({
    name,
    agent,
    sandboxAgent: sandboxAgent as (typeof SBX_AGENTS)[number],
    workspace: options.cwd,
    paneIdentity: options.paneKey ?? options.tabId ?? options.sessionId ?? name,
    policy,
    connectionId
  })
  options.command = buildShellCommandFromArgv(
    nativeAgent
      ? [
          connectionId ? 'sbx' : process.env.ORCA_SBX_BINARY || 'sbx',
          'run',
          '--name',
          name,
          '--',
          ...parsed.tokens.slice(1)
        ]
      : [
          connectionId ? 'sbx' : process.env.ORCA_SBX_BINARY || 'sbx',
          'exec',
          '-it',
          '-w',
          options.cwd,
          name,
          ...parsed.tokens
        ],
    shell
  )
  options.commandDelivery = 'provider'
  options.startupCommandDelivery = 'shell-ready'
  // The sandbox owns credentials and hooks; never forward host control-plane tokens into it.
  options.env = { ...options.env, ORCA_SBX_NAME: name }
}
