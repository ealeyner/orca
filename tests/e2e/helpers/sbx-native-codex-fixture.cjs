const readline = require('node:readline')

module.exports = function serveCodex() {
  const emit = (message) => console.log(JSON.stringify(message))
  const notify = (method, params) => emit({ method, params })
  let turns = 0
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.id === undefined || !message.method) {return}
    let result = {}
    if (message.method === 'thread/start' || message.method === 'thread/resume') {
      result = {
        thread: {
          id: message.params?.threadId || 'sandbox-thread',
          path: '/home/agent/.codex/sessions/guest.jsonl'
        }
      }
    } else if (message.method === 'model/list') {
      result = {
        data: [
          {
            id: 'sandbox-model',
            model: 'sandbox-model',
            displayName: 'Sandbox model',
            isDefault: true,
            supportedReasoningEfforts: [],
            defaultReasoningEffort: 'medium'
          }
        ],
        nextCursor: null
      }
    } else if (message.method === 'turn/start') {
      const turn = { id: `turn-${++turns}`, status: 'completed' }
      result = { turn: { ...turn, status: 'inProgress' } }
      setTimeout(() => {
        const params = { threadId: 'sandbox-thread', turnId: turn.id }
        notify('turn/started', { ...params, turn: { ...turn, status: 'inProgress' } })
        notify('item/completed', {
          ...params,
          item: { type: 'userMessage', id: `user-${turns}`, content: message.params.input }
        })
        const text = 'This reply came from the sandbox transport.'
        notify('item/started', {
          ...params,
          item: { type: 'agentMessage', id: `reply-${turns}`, text: '' }
        })
        notify('item/agentMessage/delta', { ...params, itemId: `reply-${turns}`, delta: text })
        notify('item/completed', {
          ...params,
          item: { type: 'agentMessage', id: `reply-${turns}`, text }
        })
        notify('turn/completed', { ...params, turn })
      }, 100)
    }
    emit({ id: message.id, result })
  })
}
