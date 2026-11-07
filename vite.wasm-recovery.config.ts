import path from 'node:path'
import { defineConfig, loadConfigFromFile, mergeConfig } from 'vite'

// E2E fault injection ONLY. NEVER use this config to build or ship the app.
// Both the real native package and its fetched bytes use the isolated build.
export default defineConfig(async (environment) => {
  const base = await loadConfigFromFile(
    environment,
    path.resolve('vite.config.ts')
  )
  if (!base)
    return Promise.reject(new Error('Unable to load the app Vite config'))
  return mergeConfig(base.config, {
    // Credentials belong to the runtime auth fixture, never this artifact.
    envDir: false,
    cacheDir: '.vite/wasm-recovery/vite',
    define: {
      'process.env.VITE_WASM_BASE_URL': JSON.stringify('/wasm-recovery'),
    },
    resolve: {
      alias: [
        {
          find: /^@rust\/kcl-wasm-lib\/pkg\/kcl_wasm_lib$/,
          replacement: path.resolve('.vite/wasm-recovery/pkg/kcl_wasm_lib.js'),
        },
      ],
    },
    server: { port: 3000, strictPort: true, open: false },
    build: { outDir: '.vite/wasm-recovery/renderer' },
  })
})
