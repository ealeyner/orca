import { expect, it } from 'vitest'
import { openSbxCodexConnection } from './sbx-codex-connection'
import { SbxClient } from './sbx-client'

it.skipIf(process.env.ORCA_SBX_NATIVE_SMOKE !== '1')(
  'speaks native Codex protocol in a real sandbox and proves guest shutdown',
  async () => {
    const name = process.env.ORCA_SBX_NATIVE_SMOKE_NAME
    if (!name) {
      throw new Error('Provide a disposable sandbox name in ORCA_SBX_NATIVE_SMOKE_NAME.')
    }
    const client = new SbxClient()
    const sandbox = (await client.list()).find((entry) => entry.name === name)
    if (!sandbox) {
      throw new Error('Create the disposable Codex sandbox before this test.')
    }
    const connection = await openSbxCodexConnection({
      name,
      sandboxId: sandbox.id,
      workspace: sandbox.workspaces[0],
      cliArgs: ['--config', 'model_reasoning_effort="low"']
    })
    try {
      expect(connection.pid).toBeGreaterThan(0)
      const models = await connection.request('model/list', {})
      expect(models).toMatchObject({ data: expect.any(Array) })
    } finally {
      expect(await connection.close()).toBe(true)
    }
    expect((await client.list()).find((entry) => entry.id === sandbox.id)?.status).toBe('stopped')
  },
  120_000
)
