import type { CameraControls } from '@src/clientSideScene/CameraControls'
import { cameraViewDefinitions } from '@src/lib/cameraViewCommands'
import type { Command } from '@src/lib/commandTypes'
import { ZOOM_TO_FIT_PADDING } from '@src/lib/constants'
import { reportRejection } from '@src/lib/trap'
import {
  FILE_COMMAND_SCOPES,
  MODE_MODELING_COMMAND_SCOPE,
} from '@src/registry/contracts/commands'

/** Legacy camera commands retain their IDs; defaults live beside the shared actions. */
export function createStandardViewsCommands(
  camera: Pick<CameraControls, 'updateCameraToAxis' | 'zoomToFit'>
): Command[] {
  return cameraViewDefinitions.flatMap((definition) => {
    if (!('axis' in definition) && definition.id !== 'fit') return []
    return [
      {
        id: definition.legacyCommand,
        scopes:
          definition.id === 'fit'
            ? FILE_COMMAND_SCOPES
            : [MODE_MODELING_COMMAND_SCOPE],
        name: definition.title,
        displayName: definition.title,
        description:
          definition.id === 'fit'
            ? 'Fits the model in the camera view'
            : `Set to ${definition.title.toLowerCase()}`,
        groupId: 'standardViews',
        icon: 'settings',
        needsReview: false,
        onSubmit: () => {
          const operation =
            'axis' in definition
              ? camera.updateCameraToAxis(definition.axis)
              : camera.zoomToFit({ padding: ZOOM_TO_FIT_PADDING })
          operation.catch(reportRejection)
        },
      },
    ]
  })
}
