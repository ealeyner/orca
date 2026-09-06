import { useEffect, useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import type { SbxSandbox } from '../../../../shared/sbx-types'

export type SbxCall = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

export function SbxSandboxDetails({
  sandbox,
  call,
  onChanged
}: {
  sandbox: SbxSandbox
  call: SbxCall
  onChanged: () => Promise<void>
}) {
  const [details, setDetails] = useState<{ policy: string; ports: string; logs: string } | null>(
    null
  )
  const [resource, setResource] = useState('')
  const [port, setPort] = useState('')
  const [server, setServer] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = async () => setDetails(await call('sbx.inspect', { name: sandbox.name }))
  useEffect(() => {
    let active = true
    setDetails(null)
    call<{ policy: string; ports: string; logs: string }>('sbx.inspect', { name: sandbox.name })
      .then((value) => {
        if (active) {
          setDetails(value)
        }
      })
      .catch((e) => {
        if (active) {
          setError(String(e))
        }
      })
    return () => {
      active = false
    }
  }, [sandbox.name, call])
  const act = async (method: string, params: Record<string, unknown>) => {
    setBusy(true)
    setError('')
    setResult('')
    try {
      const value = await call<unknown>(method, { name: sandbox.name, ...params })
      if (typeof value === 'string') {
        setResult(value)
      }
      await refresh()
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <h4 className="text-sm font-medium">{sandbox.name}</h4>
        <p className="break-all font-mono text-xs text-muted-foreground">
          {sandbox.workspaces.join('\n')}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="sbx-network-host">Network access</Label>
        <Input
          id="sbx-network-host"
          value={resource}
          onChange={(e) => setResource(e.target.value)}
          placeholder="api.example.com:443"
        />
        <div className="flex flex-wrap gap-2">
          {(['check', 'allow', 'deny', 'remove'] as const).map((action) => (
            <Button
              key={action}
              size="sm"
              variant="outline"
              disabled={busy || !resource.trim()}
              onClick={() => void act('sbx.network', { action, resource })}
            >
              {
                {
                  check: 'Check access',
                  allow: 'Allow host',
                  deny: 'Block host',
                  remove: 'Remove local rule'
                }[action]
              }
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Rules affect this sandbox only. Deny rules take precedence; organization policy remains
          enforced.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="sbx-port">Published ports</Label>
        <Input
          id="sbx-port"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder="3000:3000"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !port.trim()}
            onClick={() => void act('sbx.ports', { action: 'publish', port })}
          >
            Publish
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !port.trim()}
            onClick={() => void act('sbx.ports', { action: 'unpublish', port })}
          >
            Unpublish
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Ports bind to loopback by default. Use the assigned host port for IDE previews.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="sbx-load-server">Add a registered MCP server</Label>
        <Input id="sbx-load-server" value={server} onChange={(e) => setServer(e.target.value)} />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !server.trim()}
          onClick={() => void act('sbx.mcpLoad', { server })}
        >
          Load server
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {result && (
        <pre className="overflow-auto scrollbar-sleek whitespace-pre-wrap rounded-md border p-3 text-xs">
          {result}
        </pre>
      )}
      {details ? (
        (['policy', 'ports', 'logs'] as const).map((key) => (
          <details key={key}>
            <summary className="cursor-pointer text-sm">
              {
                {
                  policy: 'Effective access policy',
                  ports: 'Port mappings',
                  logs: 'Recent access decisions'
                }[key]
              }
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto scrollbar-sleek whitespace-pre-wrap rounded-md border p-3 text-xs">
              {details[key] || 'No entries'}
            </pre>
          </details>
        ))
      ) : (
        <p className="text-xs text-muted-foreground">Loading sandbox details…</p>
      )}
    </div>
  )
}
