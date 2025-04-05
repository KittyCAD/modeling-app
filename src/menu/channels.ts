import type { BrowserWindow } from 'electron'

import type { Channel } from '@src/channels'

// types for knowing what menu sends what webContent payload
export type MenuLabels =
  | 'Help.Command Palette...'
  | 'Help.Refresh and report a bug'
  | 'Help.Reset onboarding'
  | 'Edit.Rename project'
  | 'Edit.Delete project'
  | 'Edit.Change project directory'
  | 'Edit.Modify with Zoo Text-To-CAD'
  | 'Edit.Edit parameter'
  | 'Edit.Format code'
  | 'File.New project'
  | 'File.Open project'
  | 'File.Import file from URL'
  | 'File.Preferences.User settings'
  | 'File.Preferences.Keybindings'
  | 'File.Preferences.User default units'
  | 'File.Preferences.Theme'
  | 'File.Preferences.Theme color'
  | 'File.Sign out'
  | 'File.Create new file'
  | 'File.Create new folder'
  | 'File.Load a sample model'
  | 'File.Insert from project file'
  | 'File.Export current part'
  | 'File.Share current part (via Zoo link)'
  | 'File.Preferences.Project settings'
  | 'Design.Start sketch'
  | 'Design.Create an offset plane'
  | 'Design.Create a helix'
  | 'Design.Create a parameter'
  | 'Design.Create an additive feature.Extrude'
  | 'Design.Create an additive feature.Revolve'
  | 'Design.Create an additive feature.Sweep'
  | 'Design.Create an additive feature.Loft'
  | 'Design.Apply modification feature.Fillet'
  | 'Design.Apply modification feature.Chamfer'
  | 'Design.Apply modification feature.Shell'
  | 'Design.Create with Zoo Text-To-CAD'
  | 'Design.Modify with Zoo Text-To-CAD'
  | 'View.Command Palette...'
  | 'View.Orthographic view'
  | 'View.Perspective view'
  | 'View.Standard views.Right view'
  | 'View.Standard views.Back view'
  | 'View.Standard views.Top view'
  | 'View.Standard views.Left view'
  | 'View.Standard views.Front view'
  | 'View.Standard views.Bottom view'
  | 'View.Standard views.Reset view'
  | 'View.Standard views.Center view on selection'
  | 'View.Standard views.Refresh'
  | 'View.Named views.Create named view'
  | 'View.Named views.Load named view'
  | 'View.Named views.Delete named view'
  | 'View.Panes.Feature tree'
  | 'View.Panes.KCL code'
  | 'View.Panes.Project files'
  | 'View.Panes.Variables'
  | 'View.Panes.Logs'
  | 'View.Panes.Debug'
  | 'View.Standard views'
  | 'View.Named views'
  | 'Design.Create an additive feature'
  | 'Design.Apply modification feature'

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
