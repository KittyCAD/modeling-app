import type { ConfigEnv, UserConfig } from 'vite'
import { defineConfig } from 'vite'
import { pluginExposeRenderer } from './vite.base.config'
import viteTsconfigPaths from 'vite-tsconfig-paths'
import topLevelAwait from 'vite-plugin-top-level-await'
// @ts-ignore: No types available
import { lezer } from '@lezer/generator/rollup'

// https://vitejs.dev/config
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<'renderer'>
  const { root, mode, forgeConfigSelf } = forgeEnv
  const name = forgeConfigSelf?.name ?? 'main_window'

  return {
    root,
    mode,
    base: './',
    build: {
      outDir: `.vite/renderer/${name}`,
    },
    // Needed for electron-forge (in yarn tron:start)
    optimizeDeps: { esbuildOptions: { target: 'es2022' } },
    plugins: [
      pluginExposeRenderer(name),
      viteTsconfigPaths(),
      lezer(),
      // Needed for electron-builder (in yarn tronb:vite scripts)
      topLevelAwait({
        // The export name of top-level await promise for each chunk module
        promiseExportName: '__tla',
        // The function to generate import names of top-level await promise in each chunk module
        promiseImportName: (i) => `__tla_${i}`,
      }),
    ],
    worker: {
      plugins: () => [viteTsconfigPaths()],
    },
    resolve: {
      preserveSymlinks: true,
      alias: {
        '@kittycad/codemirror-lsp-client':
          '/packages/codemirror-lsp-client/src',
      },
    },
    clearScreen: false,
  } as UserConfig
})
