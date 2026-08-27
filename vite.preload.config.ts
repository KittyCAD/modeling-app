import type { ConfigEnv } from 'vite'
import { defineConfig, mergeConfig } from 'vite'
import { external, getBuildConfig, pluginHotRestart } from './vite.base.config'

/**
 * Preload build.
 *
 * Runs in a privileged context alongside the renderer, so it is bundled the
 * same way as the main process: CJS, Electron external.
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
        entry: forgeConfigSelf?.entry ?? 'src/desktop/preload.ts',
        fileName: () => '[name].js',
        formats: ['cjs'],
      },
      rollupOptions: { external },
    },
    resolve: {
      mainFields: ['module', 'jsnext:main', 'jsnext'],
      alias: [{ find: '@src', replacement: '/src' }],
    },
    plugins: [pluginHotRestart('reload')],
  })
})
