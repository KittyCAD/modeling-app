import { BrowserWindow } from "electron"

import type {roles, labels} from "./roles"
type WithPrefix<T extends string> = `${T}.${labels}`;
export type Channel = WithPrefix<roles>;

export const proxyJsChannel : Channel = 'help.proxy js'

export const typeSafeWebContentsSend = (mainWindow: BrowserWindow, channel: Channel, ...args: any[]) => {
  mainWindow.webContents.send(channel, args)
}
