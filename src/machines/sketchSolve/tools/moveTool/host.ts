import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { KclSettingsAnnotation } from '@src/lib/settings/settingsTypes'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { ConstraintHoverPopup } from '@src/machines/sketchSolve/constraints/invisibleConstraintSpriteUtils'
import type {
  SelectionCoordinates,
  SketchSolveSelectionId,
} from '@src/machines/sketchSolve/sketchSolveSelection'

/** The move interaction borrows one sketch's state and mutations; neither the renderer nor an actor owns its document. */
export interface MoveToolState {
  selectedIds: SketchSolveSelectionId[]
  selectionCoordinates?: SelectionCoordinates
  duringAreaSelectIds: number[]
  hoveredId: SketchSolveSelectionId | null
  constraintHoverPopups: ConstraintHoverPopup[]
  showNonVisualConstraints: boolean
  sketchId: number
  sketchExecOutcome?: {
    sourceDelta: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }
}
export type MoveToolMutations = Pick<
  RustContext,
  | 'editSegments'
  | 'editDistanceConstraintLabelPosition'
  | 'addConstraint'
  | 'deleteObjects'
  | 'restoreSketchCheckpoint'
  | 'sketchExecuteMock'
>
export interface MoveToolHost {
  sceneInfra: SceneInfra
  sketchId: number
  getState: () => MoveToolState
  getCheckpointId: () => number | null
  getLengthUnit: () => KclSettingsAnnotation['defaultLengthUnit']
  getSettings: () => Parameters<MoveToolMutations['editSegments']>[3]
  getModelingSettings: () => SettingsType['modeling']
  mutations: MoveToolMutations
  isCurrent: () => boolean
  selection: (data: {
    selectedIds?: SketchSolveSelectionId[]
    duringAreaSelectIds?: number[]
    replaceExistingSelection?: boolean
    selectionCoordinates?: SelectionCoordinates
  }) => void
  hover: (data: {
    hoveredId: SketchSolveSelectionId | null
    constraintHoverPopups?: ConstraintHoverPopup[]
  }) => void
  outcome: (data: {
    sourceDelta: SourceDelta
    sceneGraphDelta: SceneGraphDelta
    checkpointId?: number | null
    commit?: boolean
    suppressExecOutcomeIssues?: boolean
  }) => void
  editConstraint?: (id: number) => void
  onError: (error: unknown) => void
}
