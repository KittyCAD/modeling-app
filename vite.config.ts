import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import viteTsconfigPaths from 'vite-tsconfig-paths'
import eslint from 'vite-plugin-eslint'

export default defineConfig({
    server: {
        open: true,
        port: 3000,
    },
    build: {
      outDir: 'build',
    },
  plugins: [
    react(),
    viteTsconfigPaths(),
    eslint(),
  ],
})