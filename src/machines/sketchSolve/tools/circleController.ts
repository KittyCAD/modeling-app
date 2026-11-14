import { signal } from '@preact/signals-core'
import type { Coords2d } from '@src/lang/util'
import type { SnapTarget } from '@src/machines/sketchSolve/snapping'
import type { CircleResult } from '@src/machines/sketchSolve/tools/circleOperations'
import { isErr } from '@src/lib/trap'

export type CirclePoint = { position: Coords2d; snap?: SnapTarget }
export type CircleDraft = {
  center: Coords2d
  circleId: number
  segmentIds: number[]
  constraintIds: number[]
}
/** One controller owns the circle phase and all in-flight mutations in both sketch hosts. */
export interface CircleControllerHost {
  create: (
    point: CirclePoint
  ) => Promise<CircleResult & { draft: Omit<CircleDraft, 'center'> }>
  preview: (draft: CircleDraft, point: CirclePoint) => Promise<CircleResult>
  commit: (draft: CircleDraft, point: CirclePoint) => Promise<CircleResult>
  remove: (draft: CircleDraft) => Promise<CircleResult>
  outcome: (
    result: CircleResult,
    kind: 'preview' | 'commit' | 'remove',
    draft?: CircleDraft
  ) => void
  feedback: (point?: CirclePoint, draft?: CircleDraft) => void
  onError: (error: Error) => void
}
export function createCircleController(host: CircleControllerHost) {
  const phase = signal<
    'center' | 'creating' | 'radius' | 'committing' | 'closing' | 'closed'
  >('center')
  let draft: CircleDraft | undefined
  let pending = Promise.resolve()
  let next: CirclePoint | undefined
  let previewing = false
  let closing: Promise<void> | undefined
  const report = (cause: unknown) =>
    host.onError(
      isErr(cause) ? cause : new Error('Circle operation failed', { cause })
    )
  const schedule = (work: () => Promise<void>) => {
    pending = pending.then(work).catch(report)
    return pending
  }
  const point = (point: CirclePoint) => {
    if (closing) return pending
    if (phase.peek() === 'center') {
      phase.value = 'creating'
      return schedule(async () => {
        try {
          const result = await host.create(point)
          draft = { center: point.position, ...result.draft }
          host.outcome(result, 'preview', draft)
        } finally {
          if (!closing) phase.value = draft ? 'radius' : 'center'
        }
      })
    }
    if (phase.peek() !== 'radius' || !draft) return pending
    const current = draft
    next = undefined
    phase.value = 'committing'
    host.feedback()
    return schedule(async () => {
      try {
        const result = await host.commit(current, point)
        draft = undefined
        host.outcome(result, 'commit')
      } finally {
        if (!closing) phase.value = draft ? 'radius' : 'center'
      }
    })
  }
  const move = (point?: CirclePoint) => {
    if (closing || !['center', 'radius'].includes(phase.peek())) return
    host.feedback(point, draft)
    if (!point || !draft) return
    if (
      Math.hypot(
        point.position[0] - draft.center[0],
        point.position[1] - draft.center[1]
      ) === 0
    )
      return
    next = point
    if (previewing) return
    previewing = true
    void schedule(async () => {
      try {
        while (next && draft && !closing && phase.peek() === 'radius') {
          const point = next
          next = undefined
          const result = await host.preview(draft, point)
          if (!closing && phase.peek() === 'radius')
            host.outcome(result, 'preview', draft)
        }
      } finally {
        previewing = false
      }
    })
  }
  const remove = async () => {
    if (!draft) return
    const result = await host.remove(draft)
    draft = undefined
    host.outcome(result, 'remove')
  }
  const dispose = () => {
    if (closing) return closing
    next = undefined
    phase.value = 'closing'
    host.feedback()
    const finish = pending.then(remove)
    pending = finish.catch(report)
    closing = finish.finally(() => {
      phase.value = 'closed'
    })
    return closing
  }
  return {
    phase,
    point,
    move,
    dispose,
    getDraft: () => draft,
    settled: () => pending,
  }
}
