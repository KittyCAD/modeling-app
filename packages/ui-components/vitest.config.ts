import { resolve } from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

const workspaceRoot = resolve(__dirname, '../..')

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: {
      alias: {
        react: resolve(workspaceRoot, 'node_modules/react'),
        'react-dom': resolve(workspaceRoot, 'node_modules/react-dom'),
      },
      dedupe: ['react', 'react-dom'],
    },
    test: {
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      exclude: ['dist/**'],
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            include: ['src/**/*.unit.test.ts'],
            environment: 'node',
          },
        },
        {
          extends: true,
          test: {
            name: 'component',
            include: ['src/**/*.test.tsx'],
            environment: 'happy-dom',
          },
        },
      ],
    },
  })
)
