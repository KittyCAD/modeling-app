import OpenCascadeMain from 'opencascade.js/dist/opencascade.full.js'
import wasmUrl from 'opencascade.js/dist/opencascade.full.wasm?url'

type OpenCascadeInitOptions = {
  worker?: unknown
  libs?: unknown[]
  module?: Record<string, unknown>
}

export default async function initOpenCascade({
  worker,
  libs = [],
  module = {},
}: OpenCascadeInitOptions = {}): Promise<any> {
  const oc = await withBrowserOpenCascadeEnvironment(() =>
    OpenCascadeMain({
      locateFile(path: string) {
        if (path.endsWith('.wasm')) return wasmUrl
        if (path.endsWith('.worker.js') && typeof worker === 'string') {
          return worker
        }
        return path
      },
      ...module,
    })
  )

  for (const lib of libs) {
    await oc.loadDynamicLibrary(lib, {
      loadAsync: true,
      global: true,
      nodelete: true,
      allowUndefined: false,
    })
  }

  return oc
}

async function withBrowserOpenCascadeEnvironment<T>(
  initialize: () => Promise<T>
): Promise<T> {
  const globalWithProcess = globalThis as any
  const originalProcess = globalWithProcess.process

  try {
    globalWithProcess.process = undefined
    const initialization = initialize()
    globalWithProcess.process = originalProcess
    return await initialization
  } catch (error) {
    globalWithProcess.process = originalProcess
    throw error
  }
}
