import type { KclManager } from '@src/lang/KclManager'

export function selectSketchPlane(
  planeOrFaceId: string | undefined,
  kclManager?: KclManager
) {
  if (!kclManager || !planeOrFaceId) return

  kclManager.sceneInfra.modelingSend({
    type: 'Select sketch solve plane',
    data: planeOrFaceId,
  })
}
