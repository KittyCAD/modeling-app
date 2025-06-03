import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    globalSetup: './src/test-setup/global-setup.ts',
    environment: 'happy-dom',
    setupFiles: ['./src/setupTests.ts'],
    deps: {
      external: [/playwright/],
    },
  },
})
