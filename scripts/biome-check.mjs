#!/usr/bin/env node

import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const biomeBin = require.resolve('@biomejs/biome/bin/biome')
const rootFiles = readdirSync('.', { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.[jt]s$/.test(entry.name))
  .map((entry) => entry.name)

const targets = [
  'eslint.config.mjs',
  './src',
  ...rootFiles,
  './e2e',
  './packages',
  './rust/kcl-language-server',
]

const result = spawnSync(
  process.execPath,
  [biomeBin, 'check', ...process.argv.slice(2), ...targets],
  {
    stdio: 'inherit',
  }
)

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
