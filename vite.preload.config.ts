import type { ConfigEnv, UserConfig } from 'vite'
import { defineConfig, mergeConfig } from 'vite'
import viteTsconfigPaths from 'vite-tsconfig-paths'
import { configDefaults } from 'vitest/config'

import {
  external,
  getBuildConfig,
  getBuildDefine,
  pluginHotRestart,
} from './vite.base.config'

// https://vitejs.dev/config
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<'build'>
  const define = getBuildDefine(forgeEnv)
  const { root, mode, forgeConfigSelf } = forgeEnv
  const config: UserConfig = {
    root,
    mode,
    base: './',
    build: {
      lib: {
        entry: forgeConfigSelf?.entry ?? 'src/preload.ts',
        fileName: () => '[name].js',
        formats: ['cjs'],
      },
      rollupOptions: {
        external,
      },
    },
    resolve: {
      // Load the Node.js entry.
      mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
    plugins: [pluginHotRestart('restart'), viteTsconfigPaths()],
    worker: {
      plugins: () => [viteTsconfigPaths()],
    },
    define,
  }

  return mergeConfig(getBuildConfig(forgeEnv), config)
})
