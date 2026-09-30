import type { KclManager } from '@src/lang/KclManager'
import {
  selectDefaultSketchPlane,
  selectOffsetSketchPlane,
  selectionBodyFace,
} from '@src/lib/selections'
import { err, reportRejection } from '@src/lib/trap'

export async function selectSketchPlane(
  planeOrFaceId: string | undefined,
  useSketchSolveMode: boolean | undefined,
  kclManager?: KclManager
) {
  try {
    if (!kclManager) return
    if (!planeOrFaceId) return

    if (useSketchSolveMode) {
      kclManager.sceneInfra.modelingSend({
        type: 'Select sketch solve plane',
        data: planeOrFaceId,
      })
      return
    }

    const defaultSketchPlaneSelected = selectDefaultSketchPlane(planeOrFaceId, {
      sceneInfra: kclManager.sceneInfra,
      rustContext: kclManager.rustContext,
    })
    if (!err(defaultSketchPlaneSelected) && defaultSketchPlaneSelected) {
      return
    }

    const artifact = kclManager.artifactGraph.get(planeOrFaceId)
    const offsetPlaneSelected = await selectOffsetSketchPlane(artifact, {
      sceneInfra: kclManager.sceneInfra,
      sceneEntitiesManager: kclManager.sceneEntitiesManager,
    })
    if (!err(offsetPlaneSelected) && offsetPlaneSelected) {
      return
    }

    const sweepFaceSelected = await selectionBodyFace(
      planeOrFaceId,
      kclManager.artifactGraph,
      kclManager.ast,
      kclManager.execState,
      {
        rustContext: kclManager.rustContext,
        sceneInfra: kclManager.sceneInfra,
        sceneEntitiesManager: kclManager.sceneEntitiesManager,
        wasmInstance: await kclManager.wasmInstancePromise,
      }
    )

    if (!err(sweepFaceSelected) && sweepFaceSelected) {
      kclManager.sceneInfra.modelingSend({
        type: 'Select sketch plane',
        data: sweepFaceSelected,
      })
    }
  } catch (e) {
    reportRejection(e)
  }
}
