import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { SbxClient } from './sbx-client'
import { requireSbxIdentity } from './sbx-lifecycle'
import type { SbxNativeTarget } from './sbx-native-reservation'
import { inspectStoppedSbx } from './sbx-stopped-inspection'

const CHUNK_BYTES = 256 * 1024
const MAX_BYTES = 128 * 1024 * 1024
export const SBX_TRANSCRIPT_CHUNK_SCRIPT = `
const fs=require('fs'),path=require('path');
const [root,file,offsetText,limitText]=process.argv.slice(1);
const offset=Number(offsetText),limit=Number(limitText);
const realRoot=fs.realpathSync(root),realFile=fs.realpathSync(file);
const relative=path.relative(realRoot,realFile);
if(!relative||relative==='..'||relative.startsWith('../')||path.isAbsolute(relative))throw Error('Transcript is outside its guest account');
const fd=fs.openSync(realFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
try {
 const token=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
 const before=fs.fstatSync(fd,{bigint:true});
 if(!before.isFile()||before.size>BigInt(${MAX_BYTES})||!Number.isSafeInteger(offset)||offset<0||offset>Number(before.size)||limit!==${CHUNK_BYTES})throw Error('Invalid transcript read');
 const buffer=Buffer.alloc(Math.min(limit,Number(before.size)-offset));
 let count=0;
 while(count<buffer.length){const n=fs.readSync(fd,buffer,count,buffer.length-count,offset+count);if(!n)throw Error('Transcript changed');count+=n;}
 const after=fs.fstatSync(fd,{bigint:true});
 if(token(before)!==token(after))throw Error('Transcript changed');
 console.log(JSON.stringify({version:token(after),size:Number(after.size),offset,data:buffer.toString('base64')}));
} finally {fs.closeSync(fd);}
`

/** The temporary host path exists only while the transcript consumer runs. */
export async function withSbxTranscriptSnapshot<T>(
  input: {
    target: SbxNativeTarget
    provider: 'claude' | 'codex'
    accountHome: string
    transcriptPath: string
  },
  consume: (path: string) => Promise<T>
): Promise<T> {
  const relative = posix.relative(input.accountHome, input.transcriptPath)
  if (
    !posix.isAbsolute(input.accountHome) ||
    !posix.isAbsolute(input.transcriptPath) ||
    /[\0\r\n]/.test(input.accountHome + input.transcriptPath) ||
    !relative ||
    relative === '..' ||
    relative.startsWith('../') ||
    !input.transcriptPath.endsWith('.jsonl')
  ) {
    throw new Error('Transcript must be a JSONL file inside the pinned guest account.')
  }
  const directory = await mkdtemp(join(tmpdir(), 'orca-sbx-transcript-'))
  const localPath = join(directory, 'transcript.jsonl')
  try {
    await inspectStoppedSbx(input.target, input.provider, async () => {
      const client = new SbxClient()
      const file = await open(localPath, 'wx', 0o600)
      let offset = 0
      let version: string | undefined
      let size: number | undefined
      try {
        do {
          await requireSbxIdentity(client, input.target.name, input.target.sandboxId)
          const chunk = JSON.parse(
            await client.run(
              [
                'exec',
                '--',
                input.target.name,
                'node',
                '-e',
                SBX_TRANSCRIPT_CHUNK_SCRIPT,
                input.accountHome,
                input.transcriptPath,
                String(offset),
                String(CHUNK_BYTES)
              ],
              10_000
            )
          )
          await requireSbxIdentity(client, input.target.name, input.target.sandboxId)
          if (
            typeof chunk.version !== 'string' ||
            !chunk.version ||
            chunk.version.length > 256 ||
            !Number.isSafeInteger(chunk.size) ||
            chunk.size < 0 ||
            chunk.size > MAX_BYTES ||
            chunk.offset !== offset ||
            typeof chunk.data !== 'string' ||
            (version !== undefined && (version !== chunk.version || size !== chunk.size))
          ) {
            throw new Error('Guest transcript snapshot changed or returned invalid metadata.')
          }
          const data = Buffer.from(chunk.data, 'base64')
          if (
            data.toString('base64') !== chunk.data ||
            data.length !== Math.min(CHUNK_BYTES, chunk.size - offset)
          ) {
            throw new Error('Guest transcript snapshot returned an invalid chunk.')
          }
          await file.writeFile(data)
          version = chunk.version
          size = chunk.size
          offset += data.length
        } while (offset < size!)
      } finally {
        await file.close()
      }
    })
    return await consume(localPath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
