import { BrowserWindow } from 'electron'

import type { Channel } from '../channels'

// types for knowing what menu sends what webContent payload
export type MenuLabels =
  | 'Help.Command Palette...'
  | 'Help.Refresh and report a bug'
  | 'Help.Reset onboarding'
  | 'File.New project'
  | 'File.Open project'
  | 'File.Import file from URL'
  | 'File.Preferences.User settings'
  | 'File.Preferences.Keybindings'
  | 'File.Preferences.User default units'
  | 'File.Preferences.Theme'
  | 'File.Preferences.Theme color'
  | 'File.Sign out'
  | 'Edit.Rename project'
  | 'Edit.Delete project'
  | 'Edit.Change project directory'
  | 'View.Command Palette...'

export type WebContentSendPayload = {
  menuLabel: MenuLabels
}

// Unable to use declare module 'electron' with the interface of WebContents
// to update the send function. It did not work.
// Need to use a custom wrapper function for this.
// BrowserWindow.webContents instance is different from the WebContents and webContents...?
export const typeSafeWebContentsSend = (
  mainWindow: BrowserWindow,
  channel: Channel,
  payload: WebContentSendPayload
) => {
  mainWindow.webContents.send(channel, payload)
}
