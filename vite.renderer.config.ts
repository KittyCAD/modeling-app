import type { ConfigEnv, UserConfig } from 'vite'
import { defineConfig } from 'vite'
import { pluginExposeRenderer } from './vite.base.config'
import viteTsconfigPaths from 'vite-tsconfig-paths'
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
    optimizeDeps: { esbuildOptions: { target: 'es2022' } },
    plugins: [pluginExposeRenderer(name), viteTsconfigPaths(), lezer()],
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
