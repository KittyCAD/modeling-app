import { BrowserWindow } from 'electron'
import type { ZooLabel } from './roles'
import type {Channel} from "../channels"
export type MenuLabels =
  | `${ZooLabel}`
  | `${ZooLabel}.${ZooLabel}`
  | `${ZooLabel}.${ZooLabel}.${ZooLabel}`

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
