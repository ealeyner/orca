#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const file = process.env.ORCA_SBX_FIXTURE_STATE
const rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
const save = () => fs.writeFileSync(file, JSON.stringify(rows))
if (args[0] === 'ls') {
  console.log(JSON.stringify({ sandboxes: rows }))
} else if (args[0] === 'create') {
  const name = args[args.indexOf('--name') + 1]
  const separator = args.indexOf('--')
  rows.push({
    id: `id-${name}`,
    name,
    agent: args[separator - 1],
    status: 'stopped',
    workspaces: [args[separator + 1]]
  })
  save()
} else if (args[0] === 'run') {
  const name = args[args.indexOf('--name') + 1]
  const row = rows.find((s) => s.name === name)
  if (!row) process.exit(1)
  row.status = 'running'
  save()
  console.log(`SBX_AGENT_READY ${name}`)
  if (!args.includes('--detached')) {
    process.stdin.resume()
    process.stdin.on('data', () => {})
  }
} else if (args[0] === 'exec') {
  console.log('SBX_SHELL_READY')
  process.stdin.resume()
  process.stdin.on('data', () => {})
} else if (args[0] === 'stop') {
  const row = rows.find((s) => s.name === args[1])
  if (row) row.status = 'stopped'
  save()
} else if (args[0] === 'rm') {
  fs.writeFileSync(file, JSON.stringify(rows.filter((s) => s.name !== args.at(-1))))
} else {
  console.log('No entries')
}
