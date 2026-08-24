import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { applyGoalChangeMeta, type GoalBridgeState } from '../src/goal-bridge.js'
import { normalizeBoard, type TaskBoard } from '../src/core.js'
import type { GoalChangeMeta } from '@deepseek-ai/dsh-goal'

// Synthetic durable goal changes matching GoalSnapshotChangeMeta.
function snap(op: string, revision: number, phase: string, rounds: number, objective = 'ship the thing', blocked?: { code: string; message: string }): GoalChangeMeta {
  return {
    kind: 'goal/change',
    version: 1,
    operation: op as never,
    goal: {
      id: 'g1' as never,
      revision,
      objective,
      phase: phase as never,
      maxGoalRounds: 8,
      ...(blocked ? { blockedReason: blocked } : {}),
    } as never,
    roundsStarted: rounds,
    createdAt: 1000,
    updatedAt: 2000,
  } as GoalChangeMeta
}

function clear(revision: number): GoalChangeMeta {
  return { kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: 'g1' as never, revision }, clearedAt: 3000 } as GoalChangeMeta
}

test('create mirrors the goal as an in_progress task', () => {
  const states = new Map<string, GoalBridgeState>()
  const board = applyGoalChangeMeta(normalizeBoard(), snap('create', 1, 'active', 0), states)
  assert.equal(board.tasks.length, 1)
  assert.equal(board.tasks[0]!.id, 'goal:g1')
  assert.equal(board.tasks[0]!.title, 'ship the thing')
  assert.equal(board.tasks[0]!.status, 'in_progress')
})

test('rounds append evidence once each', () => {
  const states = new Map<string, GoalBridgeState>()
  let board = applyGoalChangeMeta(normalizeBoard(), snap('create', 1, 'active', 0), states)
  board = applyGoalChangeMeta(board, snap('edit', 2, 'active', 1), states)
  board = applyGoalChangeMeta(board, snap('edit', 3, 'active', 1), states)
  assert.equal(board.tasks[0]!.evidence.length, 1)
  assert.match(board.tasks[0]!.evidence[0]!, /round 1\/8 started/)
})

test('block and complete phases map to statuses with evidence', () => {
  const states = new Map<string, GoalBridgeState>()
  let board = applyGoalChangeMeta(normalizeBoard(), snap('create', 1, 'active', 0), states)
  board = applyGoalChangeMeta(board, snap('block', 2, 'blocked', 1, 'ship the thing', { code: 'policy-x', message: 'human approval needed' }), states)
  assert.equal(board.tasks[0]!.status, 'blocked')
  assert.ok(board.tasks[0]!.evidence.some((e) => /policy-x — human approval needed/.test(e)))
  board = applyGoalChangeMeta(board, snap('complete', 3, 'complete', 2), states)
  assert.equal(board.tasks[0]!.status, 'done')
  assert.ok(board.tasks[0]!.evidence.some((e) => /completed \(2 rounds\)/.test(e)))
})

test('stale revisions are no-ops (replay safety)', () => {
  const states = new Map<string, GoalBridgeState>()
  const board = applyGoalChangeMeta(normalizeBoard(), snap('create', 1, 'active', 0), states)
  const again = applyGoalChangeMeta(board, snap('create', 1, 'active', 0), states)
  assert.deepEqual(again, board)
})

test('clear marks the goal task done with a tombstone note', () => {
  const states = new Map<string, GoalBridgeState>()
  let board = applyGoalChangeMeta(normalizeBoard(), snap('create', 1, 'active', 0), states)
  board = applyGoalChangeMeta(board, clear(2), states)
  assert.equal(board.tasks[0]!.status, 'done')
  assert.match(board.tasks[0]!.evidence.at(-1)!, /goal cleared \(revision 2\)/)
})

test('existing manual tasks are untouched', () => {
  const states = new Map<string, GoalBridgeState>()
  let board: TaskBoard = normalizeBoard({ version: 1, tasks: [{ id: 'manual-1', title: 'manual', status: 'todo', parentId: null, evidence: [] }] })
  board = applyGoalChangeMeta(board, snap('create', 1, 'active', 0), states)
  assert.equal(board.tasks.length, 2)
  assert.equal(board.tasks[0]!.id, 'goal:g1')
  assert.equal(board.tasks[0]!.status, 'in_progress')
})
