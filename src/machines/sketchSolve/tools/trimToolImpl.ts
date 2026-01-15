import type {
  ApiObject,
  SceneGraphDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { Coords2d } from '@src/lang/util'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'

/**
 * Helper to calculate intersection between a line segment and an arc
 * @internal - exported for testing
 */
/**
 * Creates the onAreaSelectEnd callback for trim operations.
 * Handles the trim flow by processing trim points and executing trim strategies.
 *
 * @param getContextData - Function to get current context (sceneGraphDelta, sketchId, rustContext)
 * @param onNewSketchOutcome - Callback when a new sketch outcome is available
 */
export function createOnAreaSelectEndCallback({
  getContextData,
  onNewSketchOutcome,
}: {
  getContextData: () => {
    sceneGraphDelta?: SceneGraphDelta
    sketchId: number
    rustContext: RustContext
  }
  onNewSketchOutcome: (outcome: {
    kclSource: { text: string }
    sceneGraphDelta: {
      new_graph: { objects: ApiObject[] }
      new_objects: number[]
      invalidates_ids: boolean
    }
  }) => void
}): (points: Coords2d[]) => Promise<void> {
  return async (points: Coords2d[]) => {
    try {
      const contextData = getContextData()
      const { sceneGraphDelta, sketchId, rustContext } = contextData

      if (!sceneGraphDelta) {
        console.error('[TRIM] ERROR: No sceneGraphDelta available!')
        return
      }

      // Use Rust WASM execute_trim which runs the full loop internally
      const settings = await jsAppSettings(rustContext.settingsActor)
      // console.log(JSON.stringify(points))

      const result = await rustContext.executeTrim(
        0, // version
        sketchId,
        points,
        settings
      )

      // If no trim operations were performed (trim line doesn't intersect any segments),
      // return early and do nothing. This is not an error - it's a normal no-op case.
      if (!result.operationsPerformed) {
        return
      }

      // Send the result
      onNewSketchOutcome({
        kclSource: result.kclSource,
        sceneGraphDelta: result.sceneGraphDelta,
      })
    } catch (error) {
      console.error('[TRIM] Exception in onAreaSelectEnd:', error)
    }
  }
}
