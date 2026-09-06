import { getAgentCatalog } from '@/lib/agent-catalog'
import { useState } from 'react'
import {
  DEFAULT_SBX_POLICY,
  SbxLaunchPolicySchema,
  type SbxLaunchPolicy
} from '../../../../shared/sbx-types'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SettingsSwitchRow } from './SettingsFormControls'

export function SbxPolicyEditor({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}) {
  const [agent, setAgent] = useState<string>('claude')
  const [draft, setDraft] = useState<SbxLaunchPolicy>(
    settings.sbx?.agents?.claude ?? DEFAULT_SBX_POLICY
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const edit = (patch: Partial<SbxLaunchPolicy>) => setDraft((old) => ({ ...old, ...patch }))
  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const policy = SbxLaunchPolicySchema.parse({
        ...draft,
        denyNetwork: draft.denyNetwork.filter(Boolean),
        staticMcp: draft.staticMcp.filter(Boolean)
      })
      await updateSettings({
        sbx: {
          enabled: settings.sbx?.enabled ?? false,
          agents: { ...settings.sbx?.agents, [agent]: policy }
        }
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <Label>Agent access</Label>
        <Select
          value={agent}
          onValueChange={(value) => {
            setAgent(value)
            setDraft(settings.sbx?.agents?.[value] ?? DEFAULT_SBX_POLICY)
            setError('')
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {getAgentCatalog().map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <SettingsSwitchRow
        label="Allow this agent"
        checked={draft.enabled}
        onChange={() => edit({ enabled: !draft.enabled })}
        ariaLabel="Allow this agent"
      />
      <p className="text-xs text-muted-foreground">
        Docker requires the primary workspace to be writable. Extra folders, MCP servers, and
        governance profiles apply when a new sandbox is created. Existing sandboxes retain their
        access.
      </p>
      <div className="space-y-1">
        <Label htmlFor="sbx-profile">Governance profile</Label>
        <Input
          id="sbx-profile"
          value={draft.profile ?? ''}
          onChange={(e) => edit({ profile: e.target.value || undefined })}
          placeholder="Default policy"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sbx-template">Template image</Label>
        <Input
          id="sbx-template"
          value={draft.template ?? ''}
          onChange={(e) => edit({ template: e.target.value || undefined })}
          placeholder="Agent default"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="sbx-cpus">CPUs</Label>
          <Input
            id="sbx-cpus"
            type="number"
            min={1}
            max={256}
            value={draft.cpus ?? ''}
            placeholder="Auto"
            onChange={(e) => edit({ cpus: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sbx-memory">Memory</Label>
          <Input
            id="sbx-memory"
            value={draft.memory ?? ''}
            placeholder="Auto (e.g. 8g)"
            onChange={(e) => edit({ memory: e.target.value || undefined })}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="sbx-deny">Blocked network hosts</Label>
        <Input
          id="sbx-deny"
          value={draft.denyNetwork.join(', ')}
          onChange={(e) =>
            edit({
              denyNetwork: e.target.value.split(',').map((s) => s.trim())
            })
          }
          placeholder="example.com, *.example.org"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sbx-mcp">Fixed MCP servers</Label>
        <Input
          id="sbx-mcp"
          value={draft.staticMcp.join(', ')}
          onChange={(e) =>
            edit({
              staticMcp: e.target.value.split(',').map((s) => s.trim())
            })
          }
          placeholder="Registered server names"
        />
      </div>
      {draft.workspaces.map((workspace, index) => (
        <div key={index} className="space-y-2 rounded-md border p-3">
          <Input
            aria-label={`Extra folder ${index + 1}`}
            value={workspace.path}
            onChange={(e) =>
              edit({
                workspaces: draft.workspaces.map((w, i) =>
                  i === index ? { ...w, path: e.target.value } : w
                )
              })
            }
          />
          <SettingsSwitchRow
            label="Read only"
            checked={workspace.readOnly}
            onChange={() =>
              edit({
                workspaces: draft.workspaces.map((w, i) =>
                  i === index ? { ...w, readOnly: !w.readOnly } : w
                )
              })
            }
            ariaLabel={`Extra folder ${index + 1} read only`}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => edit({ workspaces: draft.workspaces.filter((_, i) => i !== index) })}
          >
            Remove folder
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => edit({ workspaces: [...draft.workspaces, { path: '', readOnly: true }] })}
        >
          Add folder
        </Button>
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save agent access'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
