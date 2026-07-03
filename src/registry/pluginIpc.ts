import type { IpcMain, IpcMainInvokeEvent } from 'electron'

export type PluginIpcChannel = `plugin:${string}`

export const PLUGIN_IPC_SYNC_ACTIVE_PLUGINS_CHANNEL =
  'plugin:sync-active-plugins' satisfies PluginIpcChannel

export function isPluginIpcChannel(
  channel: string
): channel is PluginIpcChannel {
  return channel.startsWith('plugin:')
}

export type PluginIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown

export type ElectronPluginContext = {
  ipcMain: IpcMain
  isPluginEnabled: (pluginId: string) => boolean
  handlePluginInvoke: (
    pluginId: string,
    channel: PluginIpcChannel,
    handler: PluginIpcHandler
  ) => void
}
