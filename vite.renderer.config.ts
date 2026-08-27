import preact from '@preact/preset-vite'
// @ts-ignore: No types available
import { lezer } from '@lezer/generator/rollup'
import type { ConfigEnv, UserConfig } from 'vite'
import { defineConfig } from 'vite'
import {
  createCustomLogger,
  indexHtmlCsp,
  isIgnoredWatchPath,
  pluginExposeRenderer,
} from './vite.base.config'

/**
 * Renderer build for the desktop app.
 *
 * Kept deliberately close to `vite.config.ts` (the web build) so the two do not
 * drift: same aliases, same dedupe, same plugins. The differences are the ones
 * Electron forces — a relative base for `file://`, and the forge renderer hook.
 */
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<'renderer'>
  const { root, mode, forgeConfigSelf } = forgeEnv
  const name = forgeConfigSelf?.name ?? 'main_window'

  return {
    customLogger: createCustomLogger(),
    root,
    mode,
    // Packaged renderers load over file://, so asset URLs must be relative.
    base: './',
    server: {
      watch: { ignored: isIgnoredWatchPath },
    },
    build: {
      outDir: `.vite/renderer/${name}`,
      target: 'es2022',
    },
    resolve: {
      preserveSymlinks: true,
      alias: [
        { find: '@kittycad/registry', replacement: '/packages/registry/src' },
        { find: '@kittycad/ui-kit', replacement: '/packages/ui-kit/src' },
        {
          find: '@kittycad/codemirror-lsp-client',
          replacement: '/packages/codemirror-lsp-client/src',
        },
        {
          find: '@kittycad/codemirror-lang-kcl',
          replacement: '/packages/codemirror-lang-kcl/src',
        },
        { find: '@rust', replacement: '/rust' },
        { find: '@src', replacement: '/src' },
        { find: '@public', replacement: '/public' },
        { find: '@root', replacement: '/' },
      ],
      // The registry imports @preact/signals-core directly while the app
      // imports @preact/signals; two copies would make a signal created in one
      // invisible to the other.
      dedupe: ['preact', '@preact/signals', '@preact/signals-core'],
    },
    plugins: [
      preact(),
      indexHtmlCsp(mode !== 'development'),
      pluginExposeRenderer(name),
      lezer(),
    ],
    clearScreen: false,
  } as UserConfig
})
