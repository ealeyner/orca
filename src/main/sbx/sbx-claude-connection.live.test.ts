import { expect, it } from 'vitest'
import { openSbxClaudeConnection } from './sbx-claude-connection'
import { SbxClient } from './sbx-client'

it.skipIf(process.env.ORCA_SBX_NATIVE_SMOKE !== '1')(
  'speaks Claude SDK protocol in a real sandbox and proves guest shutdown',
  async () => {
    const name = process.env.ORCA_SBX_CLAUDE_SMOKE_NAME
    if (!name) {
      throw new Error('Provide a stopped disposable Claude sandbox in ORCA_SBX_CLAUDE_SMOKE_NAME.')
    }
    const client = new SbxClient()
    const sandbox = (await client.list()).find((entry) => entry.name === name)
    if (!sandbox) {
      throw new Error('Create the disposable Claude sandbox before this test.')
    }
    const connection = await openSbxClaudeConnection({
      name,
      sandboxId: sandbox.id,
      workspace: sandbox.workspaces[0]
    })
    try {
      expect(await connection.initializationResult()).toBeTypeOf('object')
      expect(await connection.supportedModels()).toEqual(expect.any(Array))
    } finally {
      expect(await connection.close()).toBe(true)
    }
    expect((await client.list()).find((entry) => entry.id === sandbox.id)?.status).toBe('stopped')
  },
  120_000
)
