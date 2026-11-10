import { encode } from '@msgpack/msgpack'
import type { KclManager } from '@src/lang/KclManager'
import { getKclLanguageVersion } from '@src/lang/kclLanguageVersion'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type ModelingAppFile from '@src/lib/modelingAppFile'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { isErr } from '@src/lib/trap'

/** Owns a second engine connection. Never routes commands to the editor engine. */
export async function createPreviewExecutor(
  kcl: KclManager,
  token: string,
  signal: AbortSignal
) {
  const wasm = await kcl.wasmInstancePromise
  const path = kcl.path
  const settings = JSON.stringify(jsAppSettings(kcl.systemDeps.settings))
  const version = getKclLanguageVersion(kcl.ast, wasm)
  if (isErr(version)) return Promise.reject(version)
  const manager = new ConnectionManager({
    settingsActor: kcl.systemDeps.settings,
  })
  const runtime = new wasm.PreviewContext(manager, projectFsManager)
  let freed = false
  let disposed = false
  let active = 0
  const free = () => {
    if (disposed && active === 0 && !freed) {
      runtime.free()
      freed = true
    }
  }
  const close = () => {
    manager.tearDown({ route: 'service-disposed', initiatedBy: 'client' })
  }
  const dispose = () => {
    disposed = true
    signal.removeEventListener('abort', close)
    close()
    free()
  }
  signal.addEventListener('abort', close, { once: true })
  try {
    if (signal.aborted) {
      dispose()
      return Promise.reject(new Error('Preview cancelled.'))
    }
    await manager.start({
      width: 256,
      height: 256,
      token,
      geometryOnly: true,
      kclVersion: version,
      setStreamIsReady: () => {},
      rustContext: {
        sendResponse: async (message) => {
          if (!freed) await runtime.sendResponse(encode(message))
        },
      },
    })
    if (signal.aborted) {
      dispose()
      return Promise.reject(new Error('Preview cancelled.'))
    }
    return {
      async render(ast: string): Promise<ModelingAppFile[]> {
        if (disposed || signal.aborted || !manager.connection?.connected)
          return Promise.reject(new Error('Preview disconnected.'))
        active++
        try {
          return await runtime.render(ast, path, settings)
        } finally {
          active--
          free()
        }
      },
      dispose,
    }
  } catch (error) {
    dispose()
    return Promise.reject(error)
  }
}
