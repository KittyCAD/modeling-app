// @ts-ignore: No types available
import { lezer } from '@lezer/generator/rollup'
import type { ConfigEnv, UserConfig } from 'vite'
import { defineConfig } from 'vite'
import topLevelAwait from 'vite-plugin-top-level-await'
import viteTsconfigPaths from 'vite-tsconfig-paths'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

import { indexHtmlCsp, pluginExposeRenderer } from './vite.base.config'

const openCascadeViteEntry = new URL(
  './src/network/openCascadeViteEntry.ts',
  import.meta.url
).pathname
const openCascadeNodeUnsupported = new URL(
  './src/network/openCascadeNodeUnsupported.ts',
  import.meta.url
).pathname

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
    // Needed for electron-forge (in npm run tron:start)
    optimizeDeps: { esbuildOptions: { target: 'es2022' } },
    plugins: [
      nodePolyfills({
        include: ['path'],
      }),
      indexHtmlCsp(mode !== 'development'),
      pluginExposeRenderer(name),
      viteTsconfigPaths(),
      lezer(),
      // Needed for electron-builder (in npm run tronb:vite scripts)
      topLevelAwait({
        // The export name of top-level await promise for each chunk module
        promiseExportName: '__tla',
        // The function to generate import names of top-level await promise in each chunk module
        promiseImportName: (i) => `__tla_${i}`,
      }),
    ],
    worker: {
      format: 'es',
      plugins: () => [viteTsconfigPaths()],
    },
    resolve: {
      preserveSymlinks: true,
      alias: [
        { find: /^opencascade\.js$/, replacement: openCascadeViteEntry },
        {
          find: /^opencascade\.js\/dist\/node\.js$/,
          replacement: openCascadeNodeUnsupported,
        },
        {
          find: '@kittycad/codemirror-lsp-client',
          replacement: '/packages/codemirror-lsp-client/src',
        },
      ],
    },
    clearScreen: false,
  } as UserConfig
})
