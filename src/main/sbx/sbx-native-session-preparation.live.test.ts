import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { withSbxTranscriptSnapshot } from './sbx-transcript-snapshot'
import { prepareSbxNativeSession } from './sbx-native-session-preparation'
import { sandboxNameForPane } from './sbx-agent-sandbox'
import { readSbxBinding } from './sbx-bindings'
import { SbxClient } from './sbx-client'
import { changeSbxLifecycle } from './sbx-lifecycle'
const profile = vi.hoisted(() => ({ directory: '' }))
vi.mock('../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => profile.directory
}))

it.skipIf(process.env.ORCA_SBX_PREPARATION_SMOKE !== '1')(
  'provisions and pins a real native guest with retry-safe identity',
  async () => {
    profile.directory = await mkdtemp(join(tmpdir(), 'orca-sbx-native-profile-'))
    const sessionId = randomUUID()
    const name = sandboxNameForPane('claude', `native:${sessionId}`)
    const input = {
      sessionId,
      provider: 'claude' as const,
      workspace: '/tmp/orca-sbx-native-smoke',
      settings: {
        enabled: true,
        agents: {
          claude: {
            enabled: true,
            cpus: 2,
            memory: '4g',
            denyNetwork: [],
            workspaces: [],
            staticMcp: []
          }
        }
      }
    }
    try {
      const prepared = await prepareSbxNativeSession(input)
      expect(prepared.accountHome).toEqual({
        variable: 'CLAUDE_CONFIG_DIR',
        path: '/home/agent/.claude'
      })
      expect((await new SbxClient().list()).find((s) => s.id === prepared.sandbox.id)?.status).toBe(
        'stopped'
      )
      const client = new SbxClient()
      const transcriptPath = `${prepared.accountHome.path}/orca-snapshot-smoke.jsonl`
      await client.run([
        'exec',
        '--',
        name,
        'node',
        '-e',
        "require('fs').writeFileSync(process.argv[1],(JSON.stringify({text:'sandbox transcript'})+'\\n').repeat(90000))",
        transcriptPath
      ])
      await changeSbxLifecycle({ name, sandboxId: prepared.sandbox.id, action: 'stop' })
      await withSbxTranscriptSnapshot(
        {
          target: { name, sandboxId: prepared.sandbox.id, workspace: input.workspace },
          provider: 'claude',
          accountHome: prepared.accountHome.path,
          transcriptPath
        },
        async (path) => {
          const text = await readFile(path, 'utf8')
          expect(text).toBe(`${JSON.stringify({ text: 'sandbox transcript' })}\n`.repeat(90000))
          expect((await client.list()).find((s) => s.id === prepared.sandbox.id)?.status).toBe(
            'stopped'
          )
        }
      )
      expect(await prepareSbxNativeSession(input)).toEqual(prepared)
      await changeSbxLifecycle({ name, sandboxId: prepared.sandbox.id, action: 'remove' })
      await expect(prepareSbxNativeSession(input)).rejects.toThrow('identity changed')
    } finally {
      const binding = await readSbxBinding(name)
      if (binding && (await new SbxClient().list()).some((s) => s.id === binding.sandboxId)) {
        await changeSbxLifecycle({ name, sandboxId: binding.sandboxId, action: 'remove' })
      }
      await rm(profile.directory, { recursive: true, force: true })
    }
  },
  120_000
)
