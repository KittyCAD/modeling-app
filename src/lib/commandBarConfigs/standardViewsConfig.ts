import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import type { ConnectionManager } from '@src/network/connectionManager'
import { AxisNames } from '@src/lib/constants'
import { reportRejection } from '../trap'
import { engineStreamZoomToFit, engineViewIsometric } from '@src/lib/utils'

export function createStandardViewsCommands(
  engineCommandManager: ConnectionManager
) {
  const topViewCommand: Command = {
    name: 'Top view',
    displayName: `Top view`,
    description: 'Set to top view',
    groupId: 'standardViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      engineCommandManager.sceneInfra?.camControls
        .updateCameraToAxis(AxisNames.Z)
        .catch(reportRejection)
    },
  }
  const rightViewCommand: Command = {
    name: 'Right view',
    displayName: `Right view`,
    description: 'Set to right view',
    groupId: 'standardViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      engineCommandManager.sceneInfra?.camControls
        .updateCameraToAxis(AxisNames.X)
        .catch(reportRejection)
    },
  }
  const frontViewCommand: Command = {
    name: 'Front view',
    displayName: `Front view`,
    description: 'Set to front view',
    groupId: 'standardViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      engineCommandManager.sceneInfra?.camControls
        .updateCameraToAxis(AxisNames.NEG_Y)
        .catch(reportRejection)
    },
  }

  const backViewCommand: Command = {
    name: 'Back view',
    displayName: `Back view`,
    description: 'Set to back view',
    groupId: 'standardViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      engineCommandManager.sceneInfra?.camControls
        .updateCameraToAxis(AxisNames.Y)
        .catch(reportRejection)
    },
  }

  const bottomViewCommand: Command = {
    name: 'Bottom view',
    displayName: `Bottom view`,
    description: 'Set to bottom view',
    groupId: 'standardViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      engineCommandManager.sceneInfra?.camControls
        .updateCameraToAxis(AxisNames.NEG_Z)
        .catch(reportRejection)
    },
  }

  const leftViewCommand: Command = {
    name: 'Left view',
    displayName: `Left view`,
    description: 'Set to left view',
    groupId: 'standardViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      engineCommandManager.sceneInfra?.camControls
        .updateCameraToAxis(AxisNames.NEG_X)
        .catch(reportRejection)
    },
  }

  const zoomToFitCommand: Command = {
    name: 'Zoom to fit',
    displayName: `Zoom to fit`,
    description: 'Fits the model in the camera view',
    groupId: 'standardViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      engineStreamZoomToFit({ engineCommandManager, padding: 0.1 }).catch(
        reportRejection
      )
    },
  }

  return {
    topViewCommand,
    rightViewCommand,
    frontViewCommand,
    backViewCommand,
    bottomViewCommand,
    leftViewCommand,
    zoomToFitCommand,
  }
}
