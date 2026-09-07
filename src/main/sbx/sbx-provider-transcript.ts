import { posix } from 'node:path'
import { readFile } from 'node:fs/promises'
import { readCodexRolloutSessionMetaId } from '../codex/codex-rollout-session-meta'
import { proveClaudeTranscriptBranchFromJsonl } from '../claude/claude-transcript-branch-proof'
import { SbxClient } from './sbx-client'
import { requireSbxIdentity } from './sbx-lifecycle'
import type { SbxNativeTarget } from './sbx-native-reservation'
import { inspectStoppedSbx } from './sbx-stopped-inspection'
import { withSbxTranscriptSnapshot } from './sbx-transcript-snapshot'

export const SBX_TRANSCRIPT_DISCOVERY_SCRIPT = `
const fs=require('fs'),path=require('path');
const [home,provider,id]=process.argv.slice(1);
const root=path.join(home,provider==='claude'?'projects':'sessions');
let visited=0;const matches=[];
function walk(directory,depth){
 let handle;try{handle=fs.opendirSync(directory);}catch(e){if(e.code==='ENOENT')return;throw e;}
 try {let entry;while((entry=handle.readSync())){
  if(++visited>100000)throw Error('Guest transcript discovery limit exceeded');
  const file=path.join(directory,entry.name);
  if(entry.isDirectory()&&depth>0&&(provider==='claude'||/^\\d{2,4}$/.test(entry.name)))walk(file,depth-1);
  if(!entry.isFile())continue;
  const match=provider==='claude'?depth===0&&entry.name===id+'.jsonl':depth===0&&entry.name.startsWith('rollout-')&&(entry.name.endsWith('-'+id+'.jsonl')||entry.name.includes('-'+id+'_')&&entry.name.endsWith('.jsonl'));
  if(match){matches.push(file);if(matches.length>1)throw Error('Guest transcript identity is ambiguous');}
 }}finally{handle.closeSync();}
}
walk(root,provider==='claude'?1:3);
console.log(JSON.stringify({path:matches[0]||null}));
`

export async function withSbxProviderTranscript<T>(
  input: {
    target: SbxNativeTarget
    provider: 'claude' | 'codex'
    accountHome: string
    providerSessionId: string
    previousLeafUuid?: string | null
  },
  consume: (snapshot: { path: string; leafUuid: string | null }) => Promise<T>
): Promise<T> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.providerSessionId
    ) ||
    !posix.isAbsolute(input.accountHome) ||
    /[\0\r\n]/.test(input.accountHome)
  ) {
    throw new Error('Invalid pinned guest transcript identity.')
  }
  const transcriptPath = await inspectStoppedSbx(input.target, input.provider, async () => {
    const client = new SbxClient()
    await requireSbxIdentity(client, input.target.name, input.target.sandboxId)
    const result = JSON.parse(
      await client.run(
        [
          'exec',
          '--',
          input.target.name,
          'node',
          '-e',
          SBX_TRANSCRIPT_DISCOVERY_SCRIPT,
          input.accountHome,
          input.provider,
          input.providerSessionId
        ],
        10_000
      )
    )
    await requireSbxIdentity(client, input.target.name, input.target.sandboxId)
    if (typeof result.path !== 'string' || result.path.length > 4096) {
      throw new Error('The pinned provider transcript was not found in the sandbox.')
    }
    return result.path as string
  })
  return withSbxTranscriptSnapshot({ ...input, transcriptPath }, async (path) => {
    let leafUuid: string | null = null
    if (input.provider === 'codex') {
      if ((await readCodexRolloutSessionMetaId(path)) !== input.providerSessionId) {
        throw new Error('Guest Codex transcript did not prove the pinned thread identity.')
      }
    } else {
      leafUuid = proveClaudeTranscriptBranchFromJsonl({
        contents: await readFile(path, 'utf8'),
        providerSessionId: input.providerSessionId,
        previousLeafUuid: input.previousLeafUuid ?? null
      }).leafUuid
    }
    return consume({ path, leafUuid })
  })
}
