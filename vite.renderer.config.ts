// @ts-ignore: No types available
import { lezer } from '@lezer/generator/rollup'
import type { ConfigEnv, UserConfig } from 'vite'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import topLevelAwait from 'vite-plugin-top-level-await'
import viteTsconfigPaths from 'vite-tsconfig-paths'

import {
  createCustomLogger,
  indexHtmlCsp,
  isIgnoredWatchPath,
  pluginExposeRenderer,
} from './vite.base.config'

// https://vitejs.dev/config
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<'renderer'>
  const { root, mode, forgeConfigSelf } = forgeEnv
  const name = forgeConfigSelf?.name ?? 'main_window'

  return {
    customLogger: createCustomLogger(),
    root,
    mode,
    base: './',
    server: {
      watch: {
        ignored: isIgnoredWatchPath,
      },
    },
    build: {
      outDir: `.vite/renderer/${name}`,
      target: 'es2022',
    },
    // Three 0.184 uses class static blocks that esbuild can minify into
    // anonymous class expressions which crash during startup.
    esbuild: {
      supported: {
        'class-static-blocks': false,
      },
    },
    // Needed for electron-forge (in npm run tron:start). Keeping the
    // renderer-only deps explicit avoids a cold-start optimizer reload while
    // Electron is already showing the window.
    optimizeDeps: {
      include: [
        '@lezer/lr',
        'node:path',
        'path',
        'vite-plugin-node-polyfills/shims/buffer',
        'vite-plugin-node-polyfills/shims/global',
        'vite-plugin-node-polyfills/shims/process',
      ],
      esbuildOptions: { target: 'es2022' },
    },
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
