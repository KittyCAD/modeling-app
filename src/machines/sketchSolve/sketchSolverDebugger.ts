import { signal } from '@preact/signals-core'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SketchSolverTrace } from '@rust/kcl-lib/bindings/SketchSolverTrace'

export type SketchSolverDebuggerOperation = {
  id: number
  label: string
  phase: 'preview' | 'commit'
  committedAt: number
  traces: SketchSolverTrace[]
}

type SketchSolverDebugExecOutcome = SceneGraphDelta['exec_outcome'] & {
  sketchSolverTraces?: SketchSolverTrace[]
}

const MAX_DEBUGGER_OPERATIONS = 100
let nextOperationId = 1

export const sketchSolverDebuggerOperations = signal<
  SketchSolverDebuggerOperation[]
>([])

export function recordSketchSolverDebugOperation(
  label: string,
  phase: SketchSolverDebuggerOperation['phase'],
  sceneGraphDelta: SceneGraphDelta
) {
  const execOutcome =
    sceneGraphDelta.exec_outcome as SketchSolverDebugExecOutcome
  const traces = execOutcome.sketchSolverTraces ?? []
  if (!traces.length) {
    return
  }

  sketchSolverDebuggerOperations.value = [
    {
      id: nextOperationId++,
      label,
      phase,
      committedAt: Date.now(),
      traces,
    },
    ...sketchSolverDebuggerOperations.value,
  ].slice(0, MAX_DEBUGGER_OPERATIONS)
}

export function clearSketchSolverDebugOperations() {
  sketchSolverDebuggerOperations.value = []
}
