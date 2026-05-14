import { signal } from '@preact/signals-core'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SketchSolverTrace } from '@rust/kcl-lib/bindings/SketchSolverTrace'
import {
  DefaultLayoutPaneID,
  DefaultLayoutToolbarID,
} from '@src/lib/layout/configs/default'
import { LayoutType } from '@src/lib/layout/types'
import type { LayoutAreaContribution } from '@src/lib/layout/types'

export const SKETCH_DEBUGGER_PANE_ID = 'sketch-debugger'
export const SKETCH_DEBUGGER_AREA_TYPE = 'modeSketch.sketchDebugger'

export const sketchDebuggerLayoutContribution: LayoutAreaContribution = {
  id: 'mode-sketch.sketch-debugger-pane',
  kind: 'area',
  pane: {
    id: SKETCH_DEBUGGER_PANE_ID,
    label: 'Sketch Debugger',
    type: LayoutType.Simple,
    areaType: SKETCH_DEBUGGER_AREA_TYPE,
    icon: 'bug',
  },
  placement: {
    targetPaneId: DefaultLayoutToolbarID.Right,
    afterId: DefaultLayoutPaneID.TTC,
  },
  initiallyOpen: false,
}

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
