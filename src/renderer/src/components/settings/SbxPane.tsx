import { useCallback, useEffect, useRef, useState } from 'react'
import { openSandboxTerminal } from '@/lib/open-sandbox-terminal'
import { toast } from 'sonner'
import { Box, RefreshCw } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { SBX_AGENTS, DEFAULT_SBX_POLICY, type SbxSandbox } from '../../../../shared/sbx-types'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Badge } from '../ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { SettingsSwitchRow } from './SettingsFormControls'
import { SbxPolicyEditor } from './SbxPolicyEditor'
import { SbxSandboxDetails, type SbxCall } from './SbxSandboxDetails'

const EMPTY_HOSTS = new Map<string, string>()

export function SbxPane({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}) {
  const [host, setHost] = useState('local')
  const labels = useAppStore((s) => s.sshTargetLabels ?? EMPTY_HOSTS)
  const [sandboxes, setSandboxes] = useState<SbxSandbox[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [unverifiable, setUnverifiable] = useState(false)
  const [remove, setRemove] = useState<{ name: string; id: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [agent, setAgent] = useState<string>('claude')
  const environmentId = settings.activeRuntimeEnvironmentId
  const requestGeneration = useRef(0)
  const call: SbxCall = useCallback(
    (method, params) =>
      callRuntimeRpc(
        getActiveRuntimeTarget({ activeRuntimeEnvironmentId: environmentId }),
        method,
        { ...params, ...(host !== 'local' ? { connectionId: host } : {}) },
        { timeoutMs: 310_000 }
      ),
    [environmentId, host]
  )
  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current
    try {
      const rows = await call<SbxSandbox[]>('sbx.list')
      if (generation === requestGeneration.current) {
        setSandboxes(rows)
        setUnverifiable(false)
        setError('')
      }
    } catch (e) {
      if (generation === requestGeneration.current) {
        setUnverifiable(true)
        setError(e instanceof Error ? e.message : String(e))
      }
    }
  }, [call])
  const invalidate = useCallback(() => {
    ++requestGeneration.current
  }, [])
  useEffect(() => {
    setSandboxes([])
    setSelected(null)
    void refresh()
    const timer = setInterval(() => void refresh(), 10_000)
    return () => {
      invalidate()
      clearInterval(timer)
    }
  }, [refresh, invalidate])
  const act = async (action: 'start' | 'stop' | 'remove', sandbox: string, sandboxId: string) => {
    setBusy(`${action}:${sandbox}`)
    setError('')
    try {
      setSandboxes(
        await call('sbx.lifecycle', {
          name: sandbox,
          sandboxId,
          action
        })
      )
      if (action === 'remove') {
        setSelected(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }
  const openTerminal = async (name: string, mode: 'shell' | 'agent') => {
    setBusy('Opening terminal…')
    setError('')
    try {
      const launch = await call<{
        worktreeId: string
        connectionId: string | null
        command: string
        cwd: string
        title: string
      }>('sbx.prepareTerminal', { name, mode })
      await openSandboxTerminal(launch, environmentId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }
  const create = async () => {
    setBusy('Creating sandbox…')
    setError('')
    try {
      await call('sbx.create', {
        ...(settings.sbx?.agents?.[agent] ?? DEFAULT_SBX_POLICY),
        name,
        agent,
        workspace
      })
      await refresh()
      setSelected(name)
      setCreating(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }
  return (
    <section className="space-y-4" aria-label="Docker Sandboxes">
      <div className="flex items-center gap-2">
        <Box className="size-4" />
        <h3 className="text-sm font-medium">Docker Sandboxes</h3>
      </div>
      <SettingsSwitchRow
        label="Start agents in Docker Sandboxes"
        description="Each new agent pane gets its own sandbox. Launch failures never fall back to the host."
        checked={settings.sbx?.enabled === true}
        onChange={() =>
          updateSettings({ sbx: { ...settings.sbx, enabled: !settings.sbx?.enabled } })
        }
        ariaLabel="Start agents in Docker Sandboxes"
      />
      <details>
        <summary className="cursor-pointer text-sm font-medium">Agent access defaults</summary>
        <div className="pt-4">
          <SbxPolicyEditor settings={settings} updateSettings={updateSettings} />
        </div>
      </details>
      <div className="border-t pt-4 space-y-3">
        <div className="space-y-1">
          <Label>Sandbox host</Label>
          <Select value={host} disabled={Boolean(busy)} onValueChange={setHost}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">Current runtime</SelectItem>
              {Array.from(labels).map(([id, label]) => (
                <SelectItem value={id} key={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setCreating(!creating)} disabled={Boolean(busy)}>
            New sandbox
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refresh()}
            disabled={Boolean(busy)}
          >
            <RefreshCw className="size-3" />
            Refresh
          </Button>
        </div>
        {creating && (
          <div className="space-y-3 rounded-md border p-3">
            <Label htmlFor="sbx-create-name">Name</Label>
            <Input id="sbx-create-name" value={name} onChange={(e) => setName(e.target.value)} />
            <Label htmlFor="sbx-create-workspace">Workspace on selected host</Label>
            <Input
              id="sbx-create-workspace"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
            />
            <Label>Agent</Label>
            <Select value={agent} onValueChange={setAgent}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SBX_AGENTS.map((a) => (
                  <SelectItem value={a} key={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={Boolean(busy) || !name || !workspace}
              onClick={() => void create()}
            >
              Create sandbox
            </Button>
          </div>
        )}
        {busy && (
          <p role="status" className="text-xs text-muted-foreground">
            {busy}
          </p>
        )}
        {error && (
          <div role="alert" className="space-y-2">
            <p className="text-xs text-destructive">{error}</p>
            <a
              className="text-xs underline"
              href="https://docs.docker.com/ai/sandboxes/"
              target="_blank"
              rel="noreferrer"
            >
              Docker Sandboxes setup and troubleshooting
            </a>
          </div>
        )}
        {!error && !sandboxes.length && (
          <p className="text-xs text-muted-foreground">
            No sandboxes on this host. Create one here or start an agent with sandbox execution
            enabled.
          </p>
        )}
        <div className="divide-y rounded-md border">
          {sandboxes.map((s) => (
            <div key={s.id} className="space-y-2 p-3">
              <button
                className="flex w-full items-center gap-2 text-left text-sm"
                onClick={() => setSelected(selected === s.name ? null : s.name)}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <Badge variant="secondary">{unverifiable ? 'Unverifiable' : s.status}</Badge>
              </button>
              <p className="text-xs text-muted-foreground">
                {s.agent} · {s.managed ? 'Orca agent sandbox' : 'Existing sandbox'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => void openTerminal(s.name, 'agent')}
                >
                  Open agent
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => void openTerminal(s.name, 'shell')}
                >
                  Shell
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => void act(s.status === 'running' ? 'stop' : 'start', s.name, s.id)}
                >
                  {s.status === 'running' ? 'Stop' : 'Start'}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={() => setSelected(s.name)}
                >
                  Access & ports
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={() => setRemove({ name: s.name, id: s.id })}
                >
                  Remove…
                </Button>
              </div>
              {selected === s.name && (
                <SbxSandboxDetails sandbox={s} call={call} onChanged={refresh} />
              )}
            </div>
          ))}
        </div>
      </div>
      <Dialog
        open={remove !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemove(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {remove?.name}?</DialogTitle>
            <DialogDescription>
              This stops the sandbox and permanently deletes its internal files and state. Mounted
              workspace files remain on the host.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (remove) {
                  void act('remove', remove.name, remove.id)
                }
                setRemove(null)
              }}
            >
              Remove sandbox
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
