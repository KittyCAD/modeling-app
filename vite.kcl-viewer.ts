import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { Plugin } from 'vite'

/** The SDK worker fetches this fixed URL; serve the binary matching its own WASM glue. */
export function kclViewerWasm(): Plugin {
  const require = createRequire(import.meta.url)
  const viewerDirectory = dirname(
    require.resolve('@kittycad/web-view/package.json')
  )
  const sdkDirectory = dirname(
    require.resolve('@kittycad/lib/package.json', { paths: [viewerDirectory] })
  )
  const wasmPath = require.resolve(
    '@kittycad/kcl-wasm-lib/kcl_wasm_lib_bg.wasm',
    { paths: [sdkDirectory] }
  )
  const filename = 'kcl_wasm_lib_bg.wasm'
  return {
    name: 'kcl-viewer-wasm',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== `/${filename}`) return next()
        response.setHeader('Content-Type', 'application/wasm')
        response.end(readFileSync(wasmPath))
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: filename,
        source: readFileSync(wasmPath),
      })
    },
  }
}
