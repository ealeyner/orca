import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { changeSbxLifecycle } from '../../../sbx/sbx-lifecycle'
import { SbxClient } from '../../../sbx/sbx-client'
import { resolveSbxTerminalLaunch } from '../../../sbx/sbx-terminal'
import { listSbxInventory } from '../../../sbx/sbx-inventory'
import { saveSbxBinding } from '../../../sbx/sbx-bindings'
import { SbxCreateSchema, SbxName } from '../../../../shared/sbx-types'

const host = z.object({ connectionId: z.string().min(1).max(512).optional() })
const target = host.extend({ name: SbxName })
const resource = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !/[\0\r\n]/.test(s))

export const SBX_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'sbx.prepareTerminal',
    params: target.extend({ mode: z.enum(['shell', 'agent']) }),
    handler: (p, { runtime }) => resolveSbxTerminalLaunch(runtime, p.name, p.mode, p.connectionId)
  }),
  defineMethod({
    name: 'sbx.list',
    params: host,
    handler: (p) => listSbxInventory(p.connectionId)
  }),
  defineMethod({
    name: 'sbx.create',
    params: SbxCreateSchema.extend(host.shape),
    handler: async (p, { runtime }) => {
      if (!p.enabled || runtime.getClientSettings().sbx?.agents?.[p.agent]?.enabled === false) {
        throw new Error(`${p.agent} is disabled by the sandbox launch policy.`)
      }
      const created = await new SbxClient(p.connectionId).create(p)
      await saveSbxBinding({
        name: p.name,
        sandboxId: created.id,
        agent: p.agent,
        workspace: p.workspace,
        paneIdentity: 'manual',
        connectionId: p.connectionId ?? null
      })
      return created
    }
  }),
  defineMethod({
    name: 'sbx.lifecycle',
    params: target.extend({
      sandboxId: z.string().min(1),
      action: z.enum(['start', 'stop', 'remove'])
    }),
    handler: async (p) => {
      await changeSbxLifecycle(p)
      return listSbxInventory(p.connectionId)
    }
  }),
  defineMethod({
    name: 'sbx.inspect',
    params: target,
    handler: async (p) => {
      const client = new SbxClient(p.connectionId)
      const [policy, ports, logs] = await Promise.all([
        client.run(['policy', 'ls', p.name, '--wide']),
        client.run(['ports', p.name]),
        client.run(['policy', 'log', p.name, '--limit', '50'])
      ])
      return { policy, ports, logs }
    }
  }),
  defineMethod({
    name: 'sbx.network',
    params: target.extend({ action: z.enum(['allow', 'deny', 'remove', 'check']), resource }),
    handler: (p) => {
      const args =
        p.action === 'remove'
          ? ['policy', 'rm', 'network', '--sandbox', p.name, '--resource', p.resource]
          : ['policy', p.action, 'network', '--sandbox', p.name, '--', p.resource]
      return new SbxClient(p.connectionId).run(args, 30_000, p.action === 'check' ? [0, 1] : [0])
    }
  }),
  defineMethod({
    name: 'sbx.ports',
    params: target.extend({ action: z.enum(['publish', 'unpublish']), port: resource }),
    handler: (p) => new SbxClient(p.connectionId).run(['ports', p.name, `--${p.action}`, p.port])
  }),
  defineMethod({
    name: 'sbx.mcpLoad',
    params: target.extend({ server: SbxName }),
    handler: (p) =>
      new SbxClient(p.connectionId).run(['mcp', 'load', p.server, '--sandbox', p.name])
  }),
  defineMethod({
    name: 'sbx.catalog',
    params: host,
    handler: async (p) => {
      const client = new SbxClient(p.connectionId)
      const [profiles, mcp] = await Promise.all([
        client.run(['policy', 'profile', 'ls']),
        client.run(['mcp', 'ls'])
      ])
      return { profiles, mcp }
    }
  })
]
