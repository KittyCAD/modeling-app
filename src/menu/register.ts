import { commandBarActor } from 'machines/commandBarMachine'
import type { WebContentSendPayload } from '../menu/channels'
import { PATHS } from 'lib/paths'
import { authActor } from 'machines/appMachine'

export function modelingMenuCallbackMostActions (settings, navigate, filePath) {
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
    }
  }
  return cb
}
