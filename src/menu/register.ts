import { AxisNames } from '@src/lib/constants'
import { PATHS } from '@src/lib/paths'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { engineCommandManager, sceneInfra } from '@src/lib/singletons'
import {
  authActor,
  commandBarActor,
  editorManager,
  settingsActor,
} from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { activeFocusIsInput, uuidv4 } from '@src/lib/utils'
import type { WebContentSendPayload } from '@src/menu/channels'
import type { NavigateFunction } from 'react-router-dom'

export function modelingMenuCallbackMostActions(
  settings: SettingsType,
  navigate: NavigateFunction,
  filePath: string
) {
  // Menu listeners
  const cb = (data: WebContentSendPayload) => {
    if (data.menuLabel === 'File.Create project') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Create project',
          argDefaultValues: {
            name: settings.projects.defaultProjectName.current,
          },
        },
      })
    } else if (data.menuLabel === 'File.Open project') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Open project',
        },
      })
    } else if (data.menuLabel === 'Edit.Rename project') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Rename project',
        },
      })
    } else if (data.menuLabel === 'Edit.Delete project') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Delete project',
        },
      })
    } else if (data.menuLabel === 'File.Preferences.User settings') {
      navigate(filePath + PATHS.SETTINGS_USER)
    } else if (data.menuLabel === 'File.Preferences.Keybindings') {
      navigate(filePath + PATHS.SETTINGS_KEYBINDINGS)
    } else if (data.menuLabel === 'Edit.Change project directory') {
      navigate(filePath + PATHS.SETTINGS_USER + '#projectDirectory')
    } else if (data.menuLabel === 'File.Preferences.Project settings') {
      navigate(filePath + PATHS.SETTINGS_PROJECT)
    } else if (data.menuLabel === 'File.Sign out') {
      authActor.send({ type: 'Log out' })
    } else if (
      data.menuLabel === 'View.Command Palette...' ||
      data.menuLabel === 'Help.Command Palette...'
    ) {
      commandBarActor.send({ type: 'Open' })
    } else if (data.menuLabel === 'File.Preferences.Theme') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'settings',
          name: 'app.theme',
        },
      })
    } else if (data.menuLabel === 'File.Preferences.Theme color') {
      navigate(filePath + PATHS.SETTINGS_USER + '#themeColor')
    } else if (data.menuLabel === 'File.Preferences.User default units') {
      navigate(filePath + PATHS.SETTINGS_USER + '#defaultUnit')
    } else if (data.menuLabel === 'File.Add file to project') {
      const currentProject = settingsActor.getSnapshot().context.currentProject
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          name: 'add-kcl-file-to-project',
          groupId: 'application',
          argDefaultValues: {
            method: 'existingProject',
            projectName: currentProject?.name,
          },
        },
      })
    } else if (data.menuLabel === 'File.Export current part') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'modeling',
          name: 'Export',
        },
      })
    } else if (data.menuLabel === 'File.Create new file') {
      // NO OP. A safe command bar create new file is not implemented yet.
    } else if (data.menuLabel === 'Edit.Modify with Zoo Text-To-CAD') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Prompt-to-edit', groupId: 'modeling' },
      })
    } else if (data.menuLabel === 'Edit.Edit parameter') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'event.parameter.edit', groupId: 'modeling' },
      })
    } else if (data.menuLabel === 'Edit.Format code') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'format-code', groupId: 'code' },
      })
    } else if (data.menuLabel === 'Edit.Undo') {
      if (activeFocusIsInput()) {
        document.execCommand('undo')
        // Cleaner, but can't import 'electron' to this file:
        // webContents.getFocusedWebContents()?.undo()
      } else {
        editorManager.undo()
      }
    } else if (data.menuLabel === 'Edit.Redo') {
      if (activeFocusIsInput()) {
        document.execCommand('redo')
      } else {
        editorManager.redo()
      }
    } else if (data.menuLabel === 'View.Orthographic view') {
      settingsActor.send({
        type: 'set.modeling.cameraProjection',
        data: {
          level: 'user',
          value: 'orthographic',
        },
      })
    } else if (data.menuLabel === 'View.Perspective view') {
      settingsActor.send({
        type: 'set.modeling.cameraProjection',
        data: {
          level: 'user',
          value: 'perspective',
        },
      })
    } else if (data.menuLabel === 'View.Standard views.Right view') {
      sceneInfra.camControls
        .updateCameraToAxis(AxisNames.X)
        .catch(reportRejection)
    } else if (data.menuLabel === 'View.Standard views.Back view') {
      sceneInfra.camControls
        .updateCameraToAxis(AxisNames.Y)
        .catch(reportRejection)
    } else if (data.menuLabel === 'View.Standard views.Top view') {
      sceneInfra.camControls
        .updateCameraToAxis(AxisNames.Z)
        .catch(reportRejection)
    } else if (data.menuLabel === 'View.Standard views.Left view') {
      sceneInfra.camControls
        .updateCameraToAxis(AxisNames.NEG_X)
        .catch(reportRejection)
    } else if (data.menuLabel === 'View.Standard views.Front view') {
      sceneInfra.camControls
        .updateCameraToAxis(AxisNames.NEG_Y)
        .catch(reportRejection)
    } else if (data.menuLabel === 'View.Standard views.Bottom view') {
      sceneInfra.camControls
        .updateCameraToAxis(AxisNames.NEG_Z)
        .catch(reportRejection)
    } else if (data.menuLabel === 'View.Standard views.Reset view') {
      sceneInfra.camControls.resetCameraPosition().catch(reportRejection)
    } else if (
      data.menuLabel === 'View.Standard views.Center view on selection'
    ) {
      // Gotcha: out of band from modelingMachineProvider, has no state or extra workflows. I am taking the function's logic and porting it here.
      engineCommandManager
        .sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'default_camera_center_to_selection',
            camera_movement: 'vantage',
          },
        })
        .catch(reportRejection)
    } else if (data.menuLabel === 'View.Named views.Create named view') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Create named view', groupId: 'namedViews' },
      })
    } else if (data.menuLabel === 'View.Named views.Load named view') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Load named view', groupId: 'namedViews' },
      })
    } else if (data.menuLabel === 'View.Named views.Delete named view') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Delete named view', groupId: 'namedViews' },
      })
    } else if (data.menuLabel === 'Design.Create an offset plane') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Offset plane', groupId: 'modeling' },
      })
    } else if (data.menuLabel === 'Design.Create a helix') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Helix', groupId: 'modeling' },
      })
    } else if (data.menuLabel === 'Design.Create a parameter') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'event.parameter.create', groupId: 'modeling' },
      })
    } else if (data.menuLabel === 'Design.Create an additive feature.Extrude') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Extrude', groupId: 'modeling' },
      })
    } else if (data.menuLabel === 'Design.Create an additive feature.Revolve') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Revolve', groupId: 'modeling' },
      })
    } else if (data.menuLabel === 'Design.Create an additive feature.Sweep') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Sweep', groupId: 'modeling' },
      })
    } else if (data.menuLabel === 'Design.Create an additive feature.Loft') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Loft', groupId: 'modeling' },
      })
    } else if (data.menuLabel === 'Design.Apply modification feature.Fillet') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Fillet', groupId: 'modeling' },
      })
    } else if (data.menuLabel === 'Design.Apply modification feature.Chamfer') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Chamfer', groupId: 'modeling' },
      })
    } else if (data.menuLabel === 'Design.Apply modification feature.Shell') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Shell', groupId: 'modeling' },
      })
    } else if (data.menuLabel === 'Design.Insert from project file') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'code',
          name: 'Insert',
        },
      })
    } else if (data.menuLabel === 'Design.Create with Zoo Text-To-CAD') {
      const currentProject = settingsActor.getSnapshot().context.currentProject
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          name: 'Text-to-CAD',
          groupId: 'application',
          argDefaultValues: {
            method: 'existingProject',
            projectName: currentProject?.name,
          },
        },
      })
    } else if (data.menuLabel === 'Design.Modify with Zoo Text-To-CAD') {
      commandBarActor.send({
        type: 'Find and select command',
        data: { name: 'Prompt-to-edit', groupId: 'modeling' },
      })
    }
  }
  return cb
}
