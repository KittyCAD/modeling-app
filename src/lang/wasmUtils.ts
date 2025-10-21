import {
  import_file_extensions,
  relevant_file_extensions,
} from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
import { processEnv } from '@src/env'
import { webSafeJoin, webSafePathSplit } from '@src/lib/paths'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { init, reloadModule } from '@src/lib/wasm_lib_wrapper'

export const wasmUrl = () => {
  const wasmFile = '/kcl_wasm_lib_bg.wasm'
  // Check for test environment override
  if (typeof process !== 'undefined' && process.env?.VITE_WASM_BASE_URL) {
    return process.env.VITE_WASM_BASE_URL + wasmFile
  }

  // For when we're in electron (file based) or web server (network based)
  // For some reason relative paths don't work as expected. Otherwise we would
  // just do /wasm_lib_bg.wasm. In particular, the issue arises when the path
  // is used from within worker.ts.
  const fullUrl = document.location.protocol.includes('http')
    ? document.location.origin + '/kcl_wasm_lib_bg.wasm'
    : document.location.protocol +
      webSafeJoin(webSafePathSplit(document.location.pathname).slice(0, -1)) +
      wasmFile
  return fullUrl
}
// Initialise the wasm module.
const initialise = async () => {
  if (processEnv()?.VITEST) {
    const message =
      'wasmUtils is trying to call initialise. This will be blocked in VITEST runtimes.'
    console.log(message)
    return Promise.resolve(message)
  }

  try {
    await reloadModule()
    const fullUrl = wasmUrl()
    const input = await fetch(fullUrl)
    const buffer = await input.arrayBuffer()
    return await init({ module_or_path: buffer })
  } catch (e) {
    console.log('Error initialising WASM', e)
    return Promise.reject(e)
  }
}

export const initPromise = initialise()

export function importFileExtensions(wasmInstance?: ModuleType): string[] {
  const the_import_file_extensions = wasmInstance
    ? wasmInstance.import_file_extensions
    : import_file_extensions
  return the_import_file_extensions()
}

export function relevantFileExtensions(wasmInstance?: ModuleType): string[] {
  const the_relevant_file_extensions = wasmInstance
    ? wasmInstance.relevant_file_extensions
    : relevant_file_extensions
  return the_relevant_file_extensions()
}
