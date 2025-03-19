import { BrowserWindow } from 'electron'
import type { ZooLabel } from './roles'
export type Channel = `${ZooLabel}` |  `${ZooLabel}.${ZooLabel}` | `${ZooLabel}.${ZooLabel}.${ZooLabel}`

// Unable to use declare module 'electron' with the interface of WebContents
// to update the send function. It did not work.
// Need to use a custom wrapper function for this.
// BrowserWindow.webContents instance is different from the WebContents and webContents...?
export const typeSafeWebContentsSend = (
  mainWindow: BrowserWindow,
  channel: Channel,
  ...args: any[]
) => {
  mainWindow.webContents.send(channel, args)
}
