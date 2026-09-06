import { getConnectionIdFromState } from './connection-context'
import { resolveTerminalWorktreeRoute } from './terminal-worktree-route'
import { useAppStore } from '@/store'
import { createWebRuntimeSessionTerminal } from '@/runtime/web-runtime-session'
import {
  activateTerminalInitiatedWorktree,
  focusTerminalInitiatedTab
} from '@/hooks/ipc-events/terminal-command-state'

export async function openSandboxTerminal(
  launch: {
    worktreeId: string
    connectionId: string | null
    command: string
    cwd: string
    title: string
  },
  environmentId?: string | null
): Promise<void> {
  const store = useAppStore.getState()
  const worktreeId = launch.worktreeId ?? (!environmentId ? store.activeWorktreeId : null)
  if (!worktreeId) {
    throw new Error('Open the sandbox workspace in Orca before opening its terminal.')
  }
  store.closeSettingsPage()
  if (environmentId) {
    const result = await createWebRuntimeSessionTerminal({
      worktreeId,
      environmentId,
      command: launch.command,
      cwd: launch.cwd,
      startupCommandDelivery: 'shell-ready',
      activate: true
    })
    if (result.status === 'failed') {
      throw new Error(result.message)
    }
    return
  }
  const route = resolveTerminalWorktreeRoute(store, worktreeId)
  if (
    !route ||
    route.runtimeEnvironmentId ||
    getConnectionIdFromState(store, worktreeId) !== launch.connectionId
  ) {
    throw new Error('Sandbox workspace ownership changed. Reopen it on the selected host.')
  }
  activateTerminalInitiatedWorktree(store, worktreeId)
  const tab = store.createTab(worktreeId, undefined, undefined, { startupCwd: launch.cwd })
  store.queueTabStartupCommand(tab.id, {
    command: launch.command,
    startupCommandDelivery: 'shell-ready'
  })
  store.setTabCustomTitle(tab.id, launch.title, { recordInteraction: false })
  store.setActiveTabType('terminal')
  store.setActiveTab(tab.id)
  focusTerminalInitiatedTab(tab.id, undefined, worktreeId)
}
