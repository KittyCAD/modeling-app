import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
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
