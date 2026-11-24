import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: { '@src': fileURLToPath(new URL('../../', import.meta.url)) },
  },
  test: { include: ['retry.fixture.ts'], environment: 'node' },
})
