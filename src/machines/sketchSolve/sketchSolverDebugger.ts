import { signal } from '@preact/signals-core'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SketchSolverTrace } from '@rust/kcl-lib/bindings/SketchSolverTrace'
import {
  DefaultLayoutPaneID,
  DefaultLayoutToolbarID,
} from '@src/lib/layout/configs/default'
import { LayoutType } from '@src/lib/layout/types'
import type { LayoutAreaContribution } from '@src/lib/layout/types'
import type { DeepPartial } from '@src/lib/types'

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

export type SketchSolverPriorityBucket =
  | 'existingCoincident'
  | 'fixed'
  | 'dragFixed'
  | 'everythingElse'

export const SKETCH_SOLVER_PRIORITY_BUCKETS: SketchSolverPriorityBucket[] = [
  'existingCoincident',
  'fixed',
  'dragFixed',
  'everythingElse',
]

export const DEFAULT_SKETCH_SOLVER_PRIORITY_LEVELS: Record<
  SketchSolverPriorityBucket,
  number
> = {
  existingCoincident: 0,
  fixed: 0,
  dragFixed: 1,
  everythingElse: 0,
}

export const SKETCH_SOLVER_PRIORITY_BUCKET_LABELS: Record<
  SketchSolverPriorityBucket,
  string
> = {
  existingCoincident: 'Existing coincidents',
  fixed: 'Fixed constraints',
  dragFixed: 'Drag point fixes',
  everythingElse: 'Everything else',
}

export const sketchSolverDebuggerOperations = signal<
  SketchSolverDebuggerOperation[]
>([])

export const sketchSolverPriorityLevels = signal<
  Record<SketchSolverPriorityBucket, number>
>({ ...DEFAULT_SKETCH_SOLVER_PRIORITY_LEVELS })

export function setSketchSolverPriorityLevel(
  bucket: SketchSolverPriorityBucket,
  level: number
) {
  sketchSolverPriorityLevels.value = normalizeSketchSolverPriorityLevels({
    ...sketchSolverPriorityLevels.value,
    [bucket]: level,
  })
}

export function withSketchSolverPrioritySettings(
  settings: DeepPartial<Configuration>
): DeepPartial<Configuration> {
  return {
    ...settings,
    settings: {
      ...settings.settings,
      debug: {
        ...(settings.settings?.debug as Record<string, unknown> | undefined),
        sketch_solver_priority_levels: sketchSolverPriorityLevels.value,
      },
    },
  } as DeepPartial<Configuration>
}

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

function normalizeSketchSolverPriorityLevels(
  levels: Partial<Record<SketchSolverPriorityBucket, number>>
): Record<SketchSolverPriorityBucket, number> {
  const normalized = { ...DEFAULT_SKETCH_SOLVER_PRIORITY_LEVELS }
  for (const bucket of SKETCH_SOLVER_PRIORITY_BUCKETS) {
    const level = levels[bucket]
    if (typeof level === 'number' && Number.isFinite(level) && level >= 0) {
      normalized[bucket] = Math.trunc(level)
    }
  }
  return normalized
}
