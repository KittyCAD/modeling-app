import type { ConfigEnv } from 'vite'
import { defineConfig, mergeConfig } from 'vite'
import {
  external,
  getBuildConfig,
  getBuildDefine,
  pluginHotRestart,
} from './vite.base.config'

/**
 * Electron main process build.
 *
 * The main process is Node, not a browser: no JSX, no CSS, no polyfills. Its
 * only job here is to be bundled to CJS with Electron and the Node builtins
 * left external.
 */
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<'build'>
  const { forgeConfigSelf } = forgeEnv

  return mergeConfig(getBuildConfig(forgeEnv), {
    // A Node bundle has no use for the public directory, and copying it here
    // duplicates every asset in the app into the build output.
    publicDir: false,
    build: {
      lib: {
        entry: forgeConfigSelf?.entry ?? 'src/desktop/main.ts',
        fileName: () => '[name].js',
        formats: ['cjs'],
      },
      rollupOptions: { external },
    },
    resolve: {
      // Load the Node.js entry of any dependency, not the browser one.
      mainFields: ['module', 'jsnext:main', 'jsnext'],
      alias: [{ find: '@src', replacement: '/src' }],
    },
    plugins: [pluginHotRestart('restart')],
    define: getBuildDefine(forgeEnv),
  })
})
