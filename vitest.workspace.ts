import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  './vite.config.ts',
  './packages/codemirror-lang-kcl/vitest.main.config.ts',
])
