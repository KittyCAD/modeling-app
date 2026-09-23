const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const {
  INSTRUMENTATION,
  resolvePlan,
  readPlan,
  prepare,
  createAppManifest,
  verifyApp,
  verifyPair,
  createWasmManifest,
} = require('./build-comparison.cjs')

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function write(root, name, contents) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
  fs.writeFileSync(path.join(root, name), contents)
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'interaction-build-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'candidate')
  fs.mkdirSync(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Build manifest test')
  git(root, 'config', 'user.email', 'build-manifest@example.invalid')
  git(root, 'config', 'commit.gpgsign', 'false')
  write(
    root,
    '.gitignore',
    '.vite/\nrust/kcl-wasm-lib/pkg/\nrust/kcl-lib/bindings/\ninteraction-build-manifest.json\n'
  )
  for (const name of INSTRUMENTATION)
    write(root, name, 'base instrumentation\n')
  write(root, 'package-lock.json', '{"lockfileVersion":3}\n')
  write(root, 'rust/Cargo.lock', 'version = 4\n')
  write(
    root,
    'rust/kcl-lib/tests/named_views_hide_extrude/input.kcl',
    'base workload\n'
  )
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Base without comparison harness')
  const base = git(root, 'rev-parse', 'HEAD')
  write(root, 'e2e/performance/comparison.ts', 'comparison harness\n')
  for (const name of INSTRUMENTATION)
    write(root, name, 'shared instrumentation\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Add comparison harness')
  const candidate = git(root, 'rev-parse', 'HEAD')
  const baseRoot = path.join(directory, 'base')
  git(root, 'worktree', 'add', '--detach', baseRoot, base)
  return { root, baseRoot, base, candidate }
}

function artifacts(root) {
  write(
    root,
    'rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm',
    Buffer.from([0, 97, 115, 109])
  )
  write(root, 'rust/kcl-wasm-lib/pkg/kcl_wasm_lib.js', 'export default {};\n')
  write(
    root,
    'rust/kcl-lib/bindings/Settings.ts',
    'export type Settings = {};\n'
  )
  write(root, '.vite/build/main.js', "console.log('fixture application');\n")
  createWasmManifest(root, {
    node: process.version,
    rust: 'test input',
    wasmPack: 'test input',
  })
}

test('bootstrap is allowed only while the immutable base lacks the harness', (t) => {
  const { root, base, candidate } = fixture(t)
  const bootstrap = resolvePlan(root, 'push', { before: base }, candidate)
  assert.equal(bootstrap.harnessCommit, candidate)
  assert.equal(bootstrap.harnessSource, 'bootstrap-candidate')

  write(
    root,
    'e2e/performance/comparison.ts',
    'candidate changed its benchmark\n'
  )
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Change candidate harness')
  const next = git(root, 'rev-parse', 'HEAD')
  const normal = resolvePlan(root, 'push', { before: candidate }, next)
  assert.equal(normal.harnessCommit, candidate)
  assert.equal(normal.harnessSource, 'base')
  assert.equal(
    resolvePlan(
      root,
      'workflow_dispatch',
      { inputs: { 'baseline-ref': next } },
      next
    ).calibration,
    'manual-aa'
  )
  assert.throws(
    () =>
      resolvePlan(
        root,
        'pull_request',
        { pull_request: { base: { sha: base }, head: { sha: candidate } } },
        candidate
      ),
    /not the merge/
  )
})

test('real manifest producer and consumer reject mixed builds, lock drift, and changed payloads', (t) => {
  const { root, baseRoot, base, candidate } = fixture(t)
  const plan = resolvePlan(root, 'push', { before: base }, candidate)
  artifacts(baseRoot)
  artifacts(root)
  prepare(baseRoot, root, plan, 'base')
  prepare(root, root, plan, 'candidate')
  createAppManifest(baseRoot, root, plan, 'base')
  createAppManifest(root, root, plan, 'candidate')
  assert.doesNotThrow(() => verifyApp(baseRoot, root, plan, 'base'))
  assert.doesNotThrow(() => verifyApp(root, root, plan, 'candidate'))
  assert.doesNotThrow(() => verifyPair(baseRoot, root, plan))
  assert.throws(
    () => verifyApp(baseRoot, root, plan, 'candidate'),
    /Application variant/
  )

  for (const [name, expected] of [
    ['.vite/build/main.js', /Application build files/],
    ['rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm', /Wasm artifacts/],
    ['rust/kcl-lib/bindings/Settings.ts', /Wasm artifacts/],
    ['package-lock.json', /Committed file/],
    ['rust/Cargo.lock', /Committed file/],
  ]) {
    const file = path.join(baseRoot, name)
    const original = fs.readFileSync(file)
    fs.appendFileSync(file, 'changed')
    assert.throws(() => verifyApp(baseRoot, root, plan, 'base'), expected, name)
    fs.writeFileSync(file, original)
  }

  const wasmManifest = 'rust/kcl-wasm-lib/pkg/interaction-wasm-manifest.json'
  const original = fs.readFileSync(path.join(baseRoot, wasmManifest))
  fs.copyFileSync(
    path.join(root, wasmManifest),
    path.join(baseRoot, wasmManifest)
  )
  assert.throws(
    () => verifyApp(baseRoot, root, plan, 'base'),
    /Wasm source commit/
  )
  fs.writeFileSync(path.join(baseRoot, wasmManifest), original)

  fs.unlinkSync(path.join(baseRoot, '.vite/build/main.js'))
  assert.throws(
    () => verifyApp(baseRoot, root, plan, 'base'),
    /Empty build artifact/
  )
  write(
    root,
    'rust/kcl-lib/tests/named_views_hide_extrude/input.kcl',
    'changed workload\n'
  )
  assert.throws(
    () => verifyApp(root, root, plan, 'candidate'),
    /Committed file/
  )
})

test('injected calibration is confined to explicit manual A/A plans', (t) => {
  const { root, base, candidate } = fixture(t)
  for (const fault of ['first', 'warm', 'stall']) {
    const event = {
      inputs: { 'baseline-ref': candidate, 'calibration-fault': fault },
    }
    const plan = resolvePlan(root, 'workflow_dispatch', event, candidate)
    assert.equal(plan.calibration, 'manual-aa')
    assert.equal(plan.calibrationFault, fault)
    const file = path.join(root, 'plan.json')
    fs.writeFileSync(file, JSON.stringify(plan))
    assert.deepEqual(readPlan(file), plan)
    fs.writeFileSync(file, JSON.stringify({ ...plan, event: 'push' }))
    assert.throws(() => readPlan(file), /Invalid comparison plan/)
    assert.throws(
      () =>
        resolvePlan(
          root,
          'workflow_dispatch',
          { inputs: { ...event.inputs, 'baseline-ref': base } },
          candidate
        ),
      /require manual dispatch with identical commits/
    )
    assert.throws(
      () => resolvePlan(root, 'push', { ...event, before: base }, candidate),
      /require manual dispatch with identical commits/
    )
    assert.throws(
      () =>
        resolvePlan(
          root,
          'pull_request',
          {
            ...event,
            pull_request: { base: { sha: base }, head: { sha: candidate } },
          },
          candidate
        ),
      /require manual dispatch with identical commits/
    )
  }
  assert.throws(
    () =>
      resolvePlan(
        root,
        'workflow_dispatch',
        {
          inputs: { 'baseline-ref': candidate, 'calibration-fault': 'unknown' },
        },
        candidate
      ),
    /Invalid calibration fault/
  )
})

test('manual A/A rejects independently valid builds with different bytes', (t) => {
  const { root, candidate } = fixture(t)
  const baseRoot = path.join(path.dirname(root), 'same-commit-base')
  git(root, 'worktree', 'add', '--detach', baseRoot, candidate)
  const plan = resolvePlan(
    root,
    'workflow_dispatch',
    { inputs: { 'baseline-ref': candidate } },
    candidate
  )
  for (const [directory, variant] of [
    [baseRoot, 'base'],
    [root, 'candidate'],
  ]) {
    artifacts(directory)
    prepare(directory, baseRoot, plan, variant)
    createAppManifest(directory, baseRoot, plan, variant)
  }
  assert.doesNotThrow(() => verifyPair(baseRoot, root, plan))
  write(
    root,
    '.vite/build/main.js',
    'a different, independently manifested build\n'
  )
  createAppManifest(root, baseRoot, plan, 'candidate')
  assert.doesNotThrow(() => verifyApp(root, baseRoot, plan, 'candidate'))
  assert.throws(
    () => verifyPair(baseRoot, root, plan),
    /A\/A application build identity/
  )
})
