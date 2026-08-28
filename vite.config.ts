import preact from '@preact/preset-vite'
// @ts-ignore: No types available
import { lezer } from '@lezer/generator/rollup'
import { defineConfig } from 'vite'
import { createCustomLogger, indexHtmlCsp } from './vite.base.config'

export default defineConfig(({ mode }) => {
  return {
    customLogger: createCustomLogger(),
    server: {
      port: 3000,
      open: false,
    },
    build: {
      outDir: 'build',
      target: 'es2022',
    },
    resolve: {
      alias: [
        { find: '@kittycad/registry', replacement: '/packages/registry/src' },
        { find: '@kittycad/ui-kit', replacement: '/packages/ui-kit/src' },
        {
          find: '@kittycad/codemirror-lang-kcl',
          replacement: '/packages/codemirror-lang-kcl/src',
        },
        { find: '@rust', replacement: '/rust' },
        { find: '@src', replacement: '/src' },
        { find: '@public', replacement: '/public' },
        { find: '@root', replacement: '/' },
      ],
      // The registry package imports @preact/signals-core directly while the
      // app imports @preact/signals. They must share one signals-core instance
      // or a signal created in one will not be tracked by the other.
      dedupe: ['preact', '@preact/signals', '@preact/signals-core'],
    },
    plugins: [preact(), indexHtmlCsp(mode !== 'development'), lezer()],
  }
})
