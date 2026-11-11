import type {
  ElectronPluginContext,
  PluginIpcChannel,
} from '@src/registry/pluginIpc'
import { isRecord } from '@src/lib/utils'
import {
  PYORIGAMI_PLUGIN_ID,
  PYORIGAMI_RENDER_CHANNEL,
  PYORIGAMI_AUTHOR_CHANNEL,
  PYORIGAMI_CANCEL_CHANNEL,
} from '@src/registry/plugins/pyorigami/ipc'
import { isAuthoringOperation } from '@src/lib/pyorigami/authoringTypes'
import {
  executePyorigami,
  executeAuthoring,
} from '@src/registry/plugins/pyorigami/render'

export function register({
  handlePluginInvoke,
  ipcMain,
}: ElectronPluginContext) {
  const runs = new Map<string, AbortController>()
  const channels: readonly PluginIpcChannel[] = [
    PYORIGAMI_RENDER_CHANNEL,
    PYORIGAMI_AUTHOR_CHANNEL,
  ]
  for (const channel of channels)
    handlePluginInvoke(PYORIGAMI_PLUGIN_ID, channel, async (event, request) => {
      if (
        !isRecord(request) ||
        typeof request.runId !== 'string' ||
        typeof request.contents !== 'string' ||
        typeof request.src !== 'string'
      ) {
        return { ok: false, error: 'Invalid pyOrigami render request.' }
      }
      const key = `${event.sender.id}:${request.runId}`
      if (runs.has(key))
        return { ok: false, error: 'pyOrigami run already exists.' }
      const controller = new AbortController()
      runs.set(key, controller)
      const cancel = () => controller.abort()
      event.sender.once('destroyed', cancel)
      try {
        if (channel === PYORIGAMI_AUTHOR_CHANNEL) {
          if (!isAuthoringOperation(request.operation))
            return {
              ok: false,
              error: 'Invalid pyOrigami authoring operation.',
            }
          return await executeAuthoring(
            request.contents,
            request.operation,
            controller.signal
          )
        }
        return await executePyorigami(
          request.contents,
          request.src,
          controller.signal
        )
      } finally {
        event.sender.removeListener('destroyed', cancel)
        runs.delete(key)
      }
    })
  // Cancellation must still work after the plugin is disabled and its views close.
  ipcMain.handle(PYORIGAMI_CANCEL_CHANNEL, (event, request) => {
    if (isRecord(request) && typeof request.runId === 'string')
      runs.get(`${event.sender.id}:${request.runId}`)?.abort()
  })
}
