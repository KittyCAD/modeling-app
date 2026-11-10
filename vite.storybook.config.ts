import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@kittycad/ui-components': resolve(
        __dirname,
        'packages/ui-components/src/index.ts'
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
})
