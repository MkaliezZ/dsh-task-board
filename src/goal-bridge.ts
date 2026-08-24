/**
 * Goal → board bridge (pure): fold durable `goal/change` mutations into the
 * deterministic task board. One board task per goal, id `goal:<goalId>`;
 * phase transitions and admitted continuation rounds land as status changes
 * and evidence entries, so the board mirrors the goal lifecycle without the
 * agent doing anything.
 * @module @mkaliezz/dsh-task-board/goal-bridge
 */
import type { GoalChangeMeta, GoalSnapshot } from '@deepseek-ai/dsh-goal'
import { applyTaskCommand, normalizeBoard, type TaskBoard, type TaskStatus } from './core.js'

/** Per-goal fold memory so replays and stale revisions are no-ops. */
export interface GoalBridgeState {
  revision: number
  phase: GoalSnapshot['phase']
  rounds: number
  objective: string
}

export function goalTaskId(goalId: string): string {
  return `goal:${goalId}`
}

const PHASE_STATUS: Record<GoalSnapshot['phase'], TaskStatus> = {
  active: 'in_progress',
  paused: 'todo',
  blocked: 'blocked',
  complete: 'done',
}

/**
 * Apply one durable goal change to the board. Idempotent: a change at or
 * below the recorded revision is ignored (session replay safety).
 */
export function applyGoalChangeMeta(
  board: TaskBoard,
  change: GoalChangeMeta,
  states: Map<string, GoalBridgeState>,
): TaskBoard {
  let next = normalizeBoard(board)

  if (change.operation === 'clear') {
    const key = String(change.cleared.id)
    const prev = states.get(key)
    if (!prev || change.cleared.revision <= prev.revision) return next
    const id = goalTaskId(key)
    if (next.tasks.some((t) => t.id === id)) {
      next = applyTaskCommand(next, { type: 'status', id, status: 'done' })
      next = applyTaskCommand(next, { type: 'evidence', id, value: `goal cleared (revision ${change.cleared.revision})` })
    }
    states.set(key, { revision: change.cleared.revision, phase: 'complete', rounds: prev.rounds, objective: prev.objective })
    return next
  }

  const snap = change.goal
  const key = String(snap.id)
  const prev = states.get(key)
  if (prev && snap.revision <= prev.revision) return next
  const id = goalTaskId(key)
  if (!next.tasks.some((t) => t.id === id)) {
    next = applyTaskCommand(next, { type: 'create', id, title: snap.objective })
  }
  if (!prev || prev.phase !== snap.phase) {
    next = applyTaskCommand(next, { type: 'status', id, status: PHASE_STATUS[snap.phase] })
    if (snap.phase === 'blocked' && snap.blockedReason) {
      next = applyTaskCommand(next, { type: 'evidence', id, value: `blocked: ${snap.blockedReason.code} — ${snap.blockedReason.message}` })
    } else if (snap.phase === 'complete') {
      next = applyTaskCommand(next, { type: 'evidence', id, value: `completed (${change.roundsStarted} round${change.roundsStarted === 1 ? '' : 's'})` })
    } else if (snap.phase === 'paused') {
      next = applyTaskCommand(next, { type: 'evidence', id, value: 'paused' })
    }
  } else if (prev.objective !== snap.objective) {
    next = applyTaskCommand(next, { type: 'evidence', id, value: `objective → ${snap.objective}` })
  }
  if (prev && change.roundsStarted > prev.rounds) {
    next = applyTaskCommand(next, { type: 'evidence', id, value: `round ${change.roundsStarted}/${snap.maxGoalRounds} started` })
  }
  states.set(key, { revision: snap.revision, phase: snap.phase, rounds: change.roundsStarted, objective: snap.objective })
  return next
}
