export type PluginIpcChannel = `plugin:${string}`

export const PLUGIN_IPC_SYNC_ACTIVE_PLUGINS_CHANNEL =
  'plugin:sync-active-plugins' satisfies PluginIpcChannel

export function isPluginIpcChannel(
  channel: string
): channel is PluginIpcChannel {
  return channel.startsWith('plugin:')
}
