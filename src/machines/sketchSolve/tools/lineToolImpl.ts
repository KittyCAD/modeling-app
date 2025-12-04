import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { KclManager } from '@src/lang/KclManager'

export const TOOL_ID = 'Line tool'
export const CONFIRMING_DIMENSIONS = 'Confirming dimensions'
export const ADDING_POINT = `xstate.done.actor.0.${TOOL_ID}.Adding point`
export const CONFIRMING_DIMENSIONS_EVENT = `xstate.done.actor.0.${TOOL_ID}.${CONFIRMING_DIMENSIONS}`

export type ToolEvents =
  | { type: 'unequip' }
  // If the user has a draft line active, hitting escape should cancel it
  // Otherwise, it should just unequip the tool
  | { type: 'escape' }
  | {
      type: 'add point'
      data: [x: number, y: number]
      id?: number
      // The behavior of the double click is to end the line segment chaining
      isDoubleClick?: boolean
    }
  | { type: 'update selection' }
  // because the single click will still fire before the double click, we have to have a way of
  // doing the single click action (creating a new segment chained to the old one) but then catch this
  // and reverse it if a double click is detected
  | { type: 'set pending double click' }
  | {
      type: typeof ADDING_POINT | typeof CONFIRMING_DIMENSIONS_EVENT
      output: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
      }
    }

export type ToolContext = {
  draftPointId?: number
  lastLineEndPointId?: number
  isDoubleClick?: boolean
  pendingDoubleClick?: boolean
  newlyAddedSketchEntities?: {
    segmentIds: Array<number>
    constraintIds: Array<number>
  }
  pendingSketchOutcome?: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }
  deleteFromEscape?: boolean // Track if deletion was triggered by escape (vs unequip)
  sceneGraphDelta: SceneGraphDelta
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
}
