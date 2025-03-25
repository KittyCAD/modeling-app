import { commandBarActor } from 'machines/commandBarMachine'
import type { WebContentSendPayload } from '../menu/channels'
import { PATHS } from 'lib/paths'
import { authActor } from 'machines/appMachine'
import { copyFileShareLink } from 'lib/links'
import { codeManager } from 'lib/singletons'
import { settingsActor } from 'machines/appMachine'

export function modelingMenuCallbackMostActions(
  settings,
  navigate,
  filePath,
  project,
  token,
  fileSend
) {
  // Menu listeners
  // TODO: KEVIN do not run if web...
  const cb = (data: WebContentSendPayload) => {
    if (data.menuLabel === 'File.New project') {
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
    } else if (data.menuLabel === 'File.Import file from URL') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Import file from URL',
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
    } else if (data.menuLabel === 'File.Share current part (via Zoo link)') {
      copyFileShareLink({
        token: token ?? '',
        code: codeManager.code,
        name: project?.name || '',
      })
    } else if (data.menuLabel === 'File.Preferences.User default units') {
      navigate(filePath + PATHS.SETTINGS_USER + '#defaultUnit')
    } else if (data.menuLabel === 'File.Export current part') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'modeling',
          name: 'Export',
        },
      })
    } else if (data.menuLabel === 'File.Load a sample model') {
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'code',
          name: 'open-kcl-example',
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
    } else if (data.menuLabel === 'View.Orthographic view') {
      settingsActor.send({
        type: 'set.modeling.cameraProjection',
        data: {
          level: 'user',
          value: 'orthographic',
        },
      })
    }
  }
  return cb
}
