import react from '@vitejs/plugin-react'
import viteTsconfigPaths from 'vite-tsconfig-paths'
import eslint from 'vite-plugin-eslint'
import dns from 'dns'
import { defineConfig, configDefaults } from 'vitest/config'
import version from 'vite-plugin-package-version'

// Only needed because we run Node < 17 
// and we want to open `localhost` not `127.0.0.1` on server start
// reference: https://vitejs.dev/config/server-options.html#server-host
dns.setDefaultResultOrder('verbatim')

const config = defineConfig({
  server: {
    open: true,
    port: 3000,
  },
  test: {
    globals: true,
    setupFiles: 'src/setupTests.ts',
    environment: 'happy-dom',
    coverage: {
      provider: 'istanbul' // or 'v8'
    },
    exclude: [...configDefaults.exclude, '**/e2e/playwright/**/*'],
  },
  build: {
    outDir: 'build',
  },
  plugins: [
    react(),
    viteTsconfigPaths(),
    eslint(),
    version(),
  ]
})

export default config