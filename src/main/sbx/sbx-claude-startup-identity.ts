import { posix } from 'node:path'
import { SbxClient } from './sbx-client'
import { requireSbxIdentity } from './sbx-lifecycle'
import type { SbxNativeTarget } from './sbx-native-reservation'

// Read only the initialized provider's record; never enumerate another guest session.
export const SBX_CLAUDE_STARTUP_PROBE = `
const fs = require('fs'), path = require('path');
const [root, pid] = process.argv.slice(1);
const readBounded = (file, flags = 'r') => {
  const fd = fs.openSync(file, flags);
  try {
    const bytes = Buffer.alloc(65537);
    const size = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (size > 65536) throw new Error('startup metadata exceeds its bound');
    return bytes.subarray(0, size).toString('utf8');
  } finally { fs.closeSync(fd); }
};
const start = () => {
  const stat = readBounded('/proc/' + pid + '/stat');
  return stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\\s+/)[19];
};
try {
  const before = start();
  const record = JSON.parse(readBounded(path.join(root, 'sessions', pid + '.json'), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW));
  const after = start();
  console.log(JSON.stringify({ before, after, domain: 'linux::' + fs.readlinkSync('/proc/self/ns/pid'),
    record: { pid: record.pid, sessionId: record.sessionId, cwd: record.cwd, procStart: record.procStart, pidDomain: record.pidDomain } }));
} catch (error) {
  if (error.code === 'ENOENT' || error.code === 'ESRCH') console.log('null');
  else throw error;
}
`

export async function readSbxClaudeStartupIdentity(
  input: SbxNativeTarget & {
    claudeConfigDir: string
    initialization: unknown
    isActive?: () => boolean
  },
  client = new SbxClient()
): Promise<string | null> {
  const init = input.initialization as { pid?: unknown } | null
  const pid = init?.pid
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0) {
    return null
  }
  if (!posix.isAbsolute(input.claudeConfigDir) || input.claudeConfigDir.includes('\0')) {
    throw new Error('Claude startup proof requires an absolute guest account root.')
  }
  if (input.isActive?.() === false) {
    return null
  }
  const guest = await requireSbxIdentity(client, input.name, input.sandboxId)
  if (
    input.isActive?.() === false ||
    guest.status !== 'running' ||
    guest.agent !== 'claude' ||
    !guest.workspaces.includes(input.workspace)
  ) {
    return null
  }
  const output = await client.run(
    [
      'exec',
      '--',
      input.name,
      'node',
      '-e',
      SBX_CLAUDE_STARTUP_PROBE,
      input.claudeConfigDir,
      String(pid)
    ],
    5_000
  )
  const proof = JSON.parse(output) as {
    before?: unknown
    after?: unknown
    domain?: unknown
    record?: {
      pid?: unknown
      sessionId?: unknown
      cwd?: unknown
      procStart?: unknown
      pidDomain?: unknown
    }
  } | null
  const record = proof?.record
  if (
    !record ||
    record.pid !== pid ||
    record.cwd !== input.workspace ||
    typeof record.sessionId !== 'string' ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(record.sessionId) ||
    typeof proof?.before !== 'string' ||
    !/^\d+$/.test(proof.before) ||
    proof.before !== proof.after ||
    String(record.procStart) !== proof.before ||
    typeof proof.domain !== 'string' ||
    !/^linux::pid:\[\d+\]$/.test(proof.domain) ||
    record.pidDomain !== proof.domain
  ) {
    return null
  }
  if (input.isActive?.() === false) {
    return null
  }
  const current = await requireSbxIdentity(client, input.name, input.sandboxId)
  return input.isActive?.() !== false && current.status === 'running' ? record.sessionId : null
}
