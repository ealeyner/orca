import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { vi } from 'vitest'
import type { spawnProcess } from '../../shared/child-process/run-process'

type StubChild = EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  stdin: PassThrough
  pid: number
  kill: ReturnType<typeof vi.fn>
}

/** Full control over framing and death, which a real child cannot give. */
export function stubChild(options: { exitOnStdinEnd?: boolean } = {}): {
  child: StubChild
  spawnImpl: typeof spawnProcess
  written: Record<string, unknown>[]
} {
  const child = new EventEmitter() as StubChild
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new PassThrough()
  // Keep the synthetic pid outside any real process table so teardown never
  // mistakes an unrelated process for this stub.
  child.pid = 9_999_999
  child.kill = vi.fn()
  const written: Record<string, unknown>[] = []
  child.stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) {
        written.push(JSON.parse(line) as Record<string, unknown>)
      }
    }
  })
  if (options.exitOnStdinEnd !== false) {
    child.stdin.on('finish', () => child.emit('exit', 0, null))
  }
  return { child, spawnImpl: (() => child) as unknown as typeof spawnProcess, written }
}

/** Answers the handshake so `openCodexAppServerConnection` can resolve. */
export function answerInitialize(child: StubChild): void {
  child.stdin.once('data', () => {
    child.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`)
  })
}
