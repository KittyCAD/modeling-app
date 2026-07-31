'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')
const defaultTargets = [
  'src',
  'e2e',
  'packages/registry/src',
  'packages/codemirror-lsp-client/src',
  'rust/kcl-language-server/client/src',
]
const lintExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])
const parsedChunkSize = Number.parseInt(
  process.env.ESLINT_CHUNK_SIZE || '100',
  10
)
const chunkSize =
  Number.isInteger(parsedChunkSize) && parsedChunkSize > 0
    ? parsedChunkSize
    : 100
const targets = process.argv.slice(2)
const lintTargets = targets.length > 0 ? targets : defaultTargets

// Keep CI on the same ESLint rules and target set as `npm run lint`, while
// avoiding one repo-wide type-aware ESLint process that can exceed runner heap.
function collectLintFiles(target, files) {
  const absoluteTarget = path.resolve(repoRoot, target)
  if (!fs.existsSync(absoluteTarget)) {
    console.error(`ESLint target does not exist: ${target}`)
    process.exit(1)
  }

  const stat = fs.statSync(absoluteTarget)
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(absoluteTarget, { withFileTypes: true })
    for (const entry of entries) {
      collectLintFiles(path.join(target, entry.name), files)
    }
    return
  }

  if (stat.isFile() && lintExtensions.has(path.extname(absoluteTarget))) {
    files.push(target)
  }
}

const lintFiles = []
for (const target of lintTargets) {
  collectLintFiles(target, lintFiles)
}
lintFiles.sort()

if (lintFiles.length === 0) {
  console.log('No ESLint files found.')
  process.exit(0)
}

const chunks = []
for (let index = 0; index < lintFiles.length; index += chunkSize) {
  chunks.push(lintFiles.slice(index, index + chunkSize))
}

const eslintArgs = [
  '--require',
  path.join(repoRoot, 'scripts/register-typescript-eslint-typescript.cjs'),
  path.join(repoRoot, 'node_modules/eslint/bin/eslint.js'),
  '--max-warnings',
  '0',
  '--no-warn-ignored',
]

console.log(
  `Running ESLint on ${lintFiles.length} files in ${chunks.length} chunks of up to ${chunkSize}.`
)

for (let index = 0; index < chunks.length; index++) {
  const chunk = chunks[index]
  console.log(
    `ESLint chunk ${index + 1}/${chunks.length}: ${chunk.length} files`
  )
  const result = spawnSync(process.execPath, [...eslintArgs, ...chunk], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  })

  if (result.signal) {
    console.error(`ESLint chunk ${index + 1} terminated with ${result.signal}.`)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}
