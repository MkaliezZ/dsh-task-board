import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { apply } from '../src/plugin.js'

type Handler = (invocation: { rawInput?: string }) => Promise<{ kind: string; text: string }>

function capture(config: unknown = {}) {
  const commands: Record<string, Handler> = {}
  apply({
    commands: { register: (d: { name: string; handler: Handler }) => { commands[d.name] = d.handler } },
    on: () => () => {},
  } as never, config as never)
  return commands
}

test('task board create -> status -> evidence persists and renders', async () => {
  const storagePath = path.join(process.cwd(), '.task-board-test.json')
  const handlers = capture({ storagePath })
  try {
    const created = await handlers['task-create']!({ rawInput: 'T-1 对接发票接口' })
    assert.equal(created.kind, 'success')
    assert.match(created.text, /T-1/)

    const status = await handlers['task-status']!({ rawInput: 'T-1 in_progress' })
    assert.equal(status.kind, 'success')
    assert.match(status.text, /T-1/)

    const evidence = await handlers['task-evidence']!({ rawInput: 'T-1 已确认字段映射' })
    assert.equal(evidence.kind, 'success')

    const board = await handlers['task-board']!({ rawInput: '' })
    assert.match(board.text, /T-1/)

    const saved = JSON.parse(await readFile(storagePath, 'utf8')) as { tasks: { evidence: string[] }[] }
    assert.equal(saved.tasks[0]?.evidence.length, 1)
  } finally {
    await rm(storagePath, { force: true })
  }
})

test('task-create rejects duplicate ids', async () => {
  const storagePath = path.join(process.cwd(), '.task-board-test-dup.json')
  const handlers = capture({ storagePath })
  try {
    await handlers['task-create']!({ rawInput: 'T-1 first' })
    const dup = await handlers['task-create']!({ rawInput: 'T-1 second' })
    assert.equal(dup.kind, 'error')
  } finally {
    await rm(storagePath, { force: true })
  }
})
