import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  './vite.main.config.ts',
  './vite.base.config.ts',
  './vite.config.ts',
  './vite.preload.config.ts',
  './vite.renderer.config.ts',
  './packages/codemirror-lang-kcl/vitest.main.config.ts',
])
