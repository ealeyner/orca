import type { ExecutionHostId } from './execution-host'

export type AgentSessionWorkspaceKind = 'git-worktree' | 'folder'

/**
 * Where the provider process actually runs. WSL is called out separately from the execution host
 * id because a WSL workspace is served by the local host but is a distinct filesystem, account
 * root, and process namespace — two sessions there must never collide with their native twins.
 */
export type AgentSessionExecutionLocation = {
  executionHostId: ExecutionHostId
  /** Distro name when the provider runs inside WSL; null for native and remote hosts. */
  wslDistro: string | null
  workspaceId: string
  workspaceKind: AgentSessionWorkspaceKind
  /** Immutable guest namespace; the name alone can be reused after removal. */
  sandbox?: { kind: 'docker-sandbox'; id: string; name: string }
}

const MAX_ID_LENGTH = 512

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

/** NUL cannot occur in a host id, distro name, or workspace id, so no component can forge a join. */
const SCOPE_KEY_SEPARATOR = '\u0000'

/**
 * Scope key for host-and-workspace isolation. Native, WSL, and SSH copies of one workspace id are
 * different sessions; collapsing them would let one host adjudicate another host's lease.
 */
export function agentSessionScopeKey(location: AgentSessionExecutionLocation): string {
  const components = [location.executionHostId, location.wslDistro ?? '', location.workspaceId]
  if (location.sandbox) {
    components.push(location.sandbox.kind, location.sandbox.id)
  }
  return components.join(SCOPE_KEY_SEPARATOR)
}

export function agentSessionExecutionLocationsEqual(
  left: AgentSessionExecutionLocation,
  right: AgentSessionExecutionLocation
): boolean {
  return (
    agentSessionScopeKey(left) === agentSessionScopeKey(right) &&
    left.workspaceKind === right.workspaceKind
  )
}

export function isAgentSessionExecutionLocation(
  value: unknown
): value is AgentSessionExecutionLocation {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const location = value as Partial<AgentSessionExecutionLocation>
  return (
    isBoundedString(location.executionHostId, MAX_ID_LENGTH) &&
    (location.wslDistro === null || isBoundedString(location.wslDistro, MAX_ID_LENGTH)) &&
    isBoundedString(location.workspaceId, MAX_ID_LENGTH) &&
    (location.workspaceKind === 'git-worktree' || location.workspaceKind === 'folder') &&
    [location.executionHostId, location.wslDistro ?? '', location.workspaceId].every(
      (part) => !part.includes('\0')
    ) &&
    (location.sandbox === undefined ||
      (location.wslDistro === null && isAgentSessionSandbox(location.sandbox)))
  )
}

function isAgentSessionSandbox(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const sandbox = value as Record<string, unknown>
  return (
    sandbox.kind === 'docker-sandbox' &&
    isBoundedString(sandbox.id, MAX_ID_LENGTH) &&
    !sandbox.id.includes('\0') &&
    isBoundedString(sandbox.name, MAX_ID_LENGTH) &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(sandbox.name)
  )
}
