import { readSbxClaudeStartupIdentity } from '../sbx/sbx-claude-startup-identity'
import {
  requestClaudeInitialization,
  type ClaudeInitDeadline
} from './claude-structured-init-deadline'
import type { ClaudeStreamJsonConnection } from './claude-stream-json-connection'
import type { ClaudeStructuredLaunch } from './claude-structured-launch-resolution'

export async function requestClaudeSessionInitialization(input: {
  connection: ClaudeStreamJsonConnection
  sessionId: string
  timeoutMs: number
  launch: ClaudeStructuredLaunch
  deadline: ClaudeInitDeadline
}): Promise<unknown> {
  const result = await requestClaudeInitialization(
    input.connection,
    input.sessionId,
    input.timeoutMs
  )
  if (input.launch.sandbox) {
    const providerSessionId = await readSbxClaudeStartupIdentity({
      ...input.launch.sandbox,
      claudeConfigDir: input.launch.claudeConfigDir,
      initialization: result,
      isActive: () => !input.connection.closed
    })
    if (providerSessionId) {
      input.deadline.resolve({
        providerSessionId,
        uuid: null,
        model: null,
        message: {
          type: 'system',
          subtype: 'sandbox_session_verified',
          session_id: providerSessionId
        }
      })
    }
  }
  return result
}
