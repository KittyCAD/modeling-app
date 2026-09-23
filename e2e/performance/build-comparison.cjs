const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

/**
 * @typedef {object} ComparisonPlan
 * @property {1} schemaVersion
 * @property {'pull_request' | 'push' | 'workflow_dispatch'} event
 * @property {string} baseCommit
 * @property {string} candidateCommit
 * @property {string | null} prHeadCommit
 * @property {string | null} eventBaseCommit
 * @property {string} harnessCommit
 * @property {'base' | 'bootstrap-candidate'} harnessSource
 * @property {'base' | 'candidate'} harnessVariant
 * @property {'manual-aa' | 'none'} calibration
 * @property {'none' | 'first' | 'warm' | 'stall'} calibrationFault
 */

/**
 * @typedef {{ files: number, sha256: string }} ArtifactDigest
 * @typedef {{ node: string, rust: string, wasmPack: string }} WasmTools
 * @typedef {object} WasmManifest
 * @property {1} schemaVersion
 * @property {string} sourceCommit
 * @property {string} sourceTree
 * @property {Record<string, string>} lockfiles
 * @property {{ wasm: ArtifactDigest, bindings: ArtifactDigest }} artifacts
 * @property {WasmTools} tools
 */

const INSTRUMENTATION = [
  'src/lib/interactionPerformance/definitions.ts',
  'src/lib/interactionPerformance/outcomes.ts',
  'src/lib/interactionPerformance/recorder.ts',
  'src/lib/interactionPerformance/types.ts',
  'src/registry/extensions/interactionPerformance/index.ts',
  'src/registry/contracts/interactionPerformance.ts',
]
const LOCKFILES = ['package-lock.json', 'rust/Cargo.lock']
const WORKLOAD = 'rust/kcl-lib/tests/named_views_hide_extrude/input.kcl'
const WASM_MANIFEST = 'rust/kcl-wasm-lib/pkg/interaction-wasm-manifest.json'
const APP_MANIFEST = 'interaction-build-manifest.json'
const COMPARISON_ENTRY = 'e2e/performance/comparison.ts'

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function requireEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match the comparison plan`)
  }
}

function commit(root, ref) {
  const result = git(
    root,
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${ref}^{commit}`
  )
  if (!/^[a-f0-9]{40}$/.test(result)) throw new Error('Invalid commit SHA')
  return result
}

function hasComparison(root, ref) {
  return (
    git(root, 'ls-tree', '--name-only', ref, '--', COMPARISON_ENTRY) ===
    COMPARISON_ENTRY
  )
}

function resolvePlan(root, eventName, event, candidateRef) {
  const candidateCommit = commit(root, candidateRef)
  let baseRef
  let prHeadCommit = null
  let eventBaseCommit = null
  if (eventName === 'pull_request') {
    baseRef = event.pull_request.base.sha
    prHeadCommit = commit(root, event.pull_request.head.sha)
  } else if (eventName === 'push') {
    baseRef = event.before
  } else if (eventName === 'workflow_dispatch') {
    baseRef = event.inputs?.['baseline-ref'] || `${candidateCommit}^1`
  } else {
    throw new Error('Unsupported comparison event')
  }
  let baseCommit = commit(root, baseRef)
  if (eventName === 'workflow_dispatch') {
    // A manual run on main must not execute an unrelated, unreviewed ref with
    // the default branch's workflow privileges.
    try {
      git(root, 'merge-base', '--is-ancestor', baseCommit, candidateCommit)
    } catch {
      throw new Error('Manual baseline must be an ancestor of the candidate')
    }
  }
  const calibrationFault = event.inputs?.['calibration-fault'] || 'none'
  if (!['none', 'first', 'warm', 'stall'].includes(calibrationFault)) {
    throw new Error('Invalid calibration fault')
  }
  if (
    calibrationFault !== 'none' &&
    (eventName !== 'workflow_dispatch' || baseCommit !== candidateCommit)
  ) {
    throw new Error(
      'Calibration faults require manual dispatch with identical commits'
    )
  }
  if (eventName === 'pull_request') {
    const parents = git(
      root,
      'rev-list',
      '--parents',
      '-n',
      '1',
      candidateCommit
    )
      .split(' ')
      .slice(1)
    if (parents.length !== 2 || parents[1] !== prHeadCommit) {
      throw new Error(
        'Candidate is not the merge of a base and the exact event PR head'
      )
    }
    // GitHub can regenerate the tested merge after the event's base advanced.
    // Its first parent is the exact baseline used to produce this candidate.
    eventBaseCommit = baseCommit
    baseCommit = parents[0]
    try {
      git(root, 'merge-base', '--is-ancestor', eventBaseCommit, baseCommit)
    } catch {
      throw new Error('Event base is not an ancestor of the tested baseline')
    }
  }
  const harnessSource = hasComparison(root, baseCommit)
    ? 'base'
    : 'bootstrap-candidate'
  const harnessCommit = harnessSource === 'base' ? baseCommit : candidateCommit
  if (!hasComparison(root, harnessCommit))
    throw new Error('Selected harness has no comparison entrypoint')
  return {
    schemaVersion: 1,
    event: eventName,
    baseCommit,
    candidateCommit,
    prHeadCommit,
    eventBaseCommit,
    harnessCommit,
    harnessSource,
    harnessVariant: harnessSource === 'base' ? 'base' : 'candidate',
    calibration:
      eventName === 'workflow_dispatch' && baseCommit === candidateCommit
        ? 'manual-aa'
        : 'none',
    calibrationFault,
  }
}

/** @returns {ComparisonPlan} */
function readPlan(file) {
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (
    plan.schemaVersion !== 1 ||
    !['pull_request', 'push', 'workflow_dispatch'].includes(plan.event) ||
    ![plan.baseCommit, plan.candidateCommit, plan.harnessCommit].every(
      (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
    ) ||
    !(plan.event === 'pull_request'
      ? [plan.prHeadCommit, plan.eventBaseCommit].every(
          (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
        )
      : plan.prHeadCommit === null && plan.eventBaseCommit === null) ||
    !['base', 'bootstrap-candidate'].includes(plan.harnessSource) ||
    plan.harnessVariant !==
      (plan.harnessSource === 'base' ? 'base' : 'candidate') ||
    plan.harnessCommit !==
      (plan.harnessSource === 'base'
        ? plan.baseCommit
        : plan.candidateCommit) ||
    plan.calibration !==
      (plan.event === 'workflow_dispatch' &&
      plan.baseCommit === plan.candidateCommit
        ? 'manual-aa'
        : 'none') ||
    !['none', 'first', 'warm', 'stall'].includes(plan.calibrationFault) ||
    (plan.calibrationFault !== 'none' && plan.calibration !== 'manual-aa')
  )
    throw new Error('Invalid comparison plan')
  return plan
}

function expectedSource(plan, variant) {
  if (!['base', 'candidate'].includes(variant))
    throw new Error('Invalid application variant')
  return variant === 'base' ? plan.baseCommit : plan.candidateCommit
}

function source(root, expected) {
  const sourceCommit = commit(root, 'HEAD')
  if (expected) requireEqual(sourceCommit, expected, 'Application commit')
  return { sourceCommit, sourceTree: git(root, 'rev-parse', 'HEAD^{tree}') }
}

function fileBytes(root, name) {
  const file = path.join(root, name)
  if (!fs.lstatSync(file).isFile())
    throw new Error(`Expected regular file: ${name}`)
  return fs.readFileSync(file)
}

function fileHash(root, name) {
  return sha256(fileBytes(root, name))
}

function committedHashes(root, names) {
  return Object.fromEntries(
    names.map((name) => {
      const contents = fileBytes(root, name)
      requireEqual(
        execFileSync(
          'git',
          ['-C', root, 'hash-object', '--no-filters', '--stdin'],
          {
            input: contents,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
          }
        ).trim(),
        git(root, 'rev-parse', '--verify', `HEAD:${name}`),
        `Committed file ${name}`
      )
      return [name, sha256(contents)]
    })
  )
}

function treeHash(root, directory, include = () => true) {
  const files = []
  function visit(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const name = `${relative}/${entry.name}`
      if (entry.isDirectory()) visit(name)
      else if (entry.isFile()) {
        if (include(name)) files.push([name, fileHash(root, name)])
      } else throw new Error(`Unexpected non-regular build artifact: ${name}`)
    }
  }
  visit(directory)
  files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (!files.length) throw new Error(`Empty build artifact: ${directory}`)
  return { files: files.length, sha256: sha256(JSON.stringify(files)) }
}

function wasmArtifacts(root) {
  // Exclude only this manifest, whose digest cannot include itself.
  return {
    wasm: treeHash(root, 'rust/kcl-wasm-lib/pkg', (name) =>
      path.basename(name).startsWith('kcl_wasm_lib')
    ),
    bindings: treeHash(root, 'rust/kcl-lib/bindings'),
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * @param {string} root
 * @param {WasmTools} tools
 * @returns {WasmManifest}
 */
function createWasmManifest(root, tools) {
  const manifest = {
    schemaVersion: 1,
    ...source(root),
    lockfiles: committedHashes(root, LOCKFILES),
    artifacts: wasmArtifacts(root),
    tools,
  }
  writeJson(path.join(root, WASM_MANIFEST), manifest)
  return manifest
}

function verifyWasm(root, expected) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, WASM_MANIFEST), 'utf8')
  )
  requireEqual(manifest.schemaVersion, 1, 'Wasm manifest version')
  const actualSource = source(root, expected)
  requireEqual(
    manifest.sourceCommit,
    actualSource.sourceCommit,
    'Wasm source commit'
  )
  requireEqual(manifest.sourceTree, actualSource.sourceTree, 'Wasm source tree')
  requireEqual(
    manifest.lockfiles,
    committedHashes(root, LOCKFILES),
    'Wasm lockfiles'
  )
  requireEqual(manifest.artifacts, wasmArtifacts(root), 'Wasm artifacts')
  return manifest
}

function harnessIdentity(root, plan) {
  requireEqual(commit(root, 'HEAD'), plan.harnessCommit, 'Harness commit')
  const paths = git(
    root,
    'ls-files',
    '--',
    'e2e/performance',
    'e2e/playwright',
    'src/lib/interactionPerformance',
    ...INSTRUMENTATION,
    'playwright.performance.config.ts',
    'tsconfig.json',
    '.nvmrc',
    'package-lock.json',
    WORKLOAD
  )
    .split('\n')
    .filter(Boolean)
    .sort()
  const files = committedHashes(root, [...new Set(paths)])
  return {
    commit: plan.harnessCommit,
    source: plan.harnessSource,
    sha256: sha256(JSON.stringify(files)),
    instrumentation: committedHashes(root, INSTRUMENTATION),
    workload: committedHashes(root, [WORKLOAD]),
  }
}

function prepare(root, harnessRoot, plan, variant) {
  source(root, expectedSource(plan, variant))
  harnessIdentity(harnessRoot, plan)
  verifyWasm(root, expectedSource(plan, variant))
  for (const name of INSTRUMENTATION) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    if (path.resolve(root) !== path.resolve(harnessRoot))
      fs.copyFileSync(path.join(harnessRoot, name), path.join(root, name))
  }
}

function createAppManifest(root, harnessRoot, plan, variant) {
  const identity = harnessIdentity(harnessRoot, plan)
  const changed = git(root, 'diff', '--name-only', 'HEAD', '--')
    .split('\n')
    .filter(Boolean)
  if (changed.some((name) => !INSTRUMENTATION.includes(name)))
    throw new Error(
      'Application source changed outside the instrumentation overlay'
    )
  requireEqual(
    Object.fromEntries(
      INSTRUMENTATION.map((name) => [name, fileHash(root, name)])
    ),
    identity.instrumentation,
    'Instrumentation overlay'
  )
  const manifest = {
    schemaVersion: 1,
    variant,
    ...source(root, expectedSource(plan, variant)),
    plan,
    harness: identity,
    lockfiles: committedHashes(root, LOCKFILES),
    wasm: verifyWasm(root, expectedSource(plan, variant)),
    build: treeHash(root, '.vite'),
    buildNode: process.version,
  }
  writeJson(path.join(root, APP_MANIFEST), manifest)
  return manifest
}

function verifyApp(root, harnessRoot, plan, variant) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, APP_MANIFEST), 'utf8')
  )
  requireEqual(manifest.schemaVersion, 1, 'Application manifest version')
  requireEqual(manifest.variant, variant, 'Application variant')
  const actualSource = source(root, expectedSource(plan, variant))
  requireEqual(
    manifest.sourceCommit,
    actualSource.sourceCommit,
    'Application source commit'
  )
  requireEqual(
    manifest.sourceTree,
    actualSource.sourceTree,
    'Application source tree'
  )
  requireEqual(manifest.plan, plan, 'Application build plan')
  requireEqual(
    manifest.harness,
    harnessIdentity(harnessRoot, plan),
    'Application harness'
  )
  requireEqual(
    manifest.lockfiles,
    committedHashes(root, LOCKFILES),
    'Application lockfiles'
  )
  requireEqual(
    manifest.wasm,
    verifyWasm(root, expectedSource(plan, variant)),
    'Application Wasm manifest'
  )
  requireEqual(
    manifest.build,
    treeHash(root, '.vite'),
    'Application build files'
  )
  return manifest
}

function verifyPair(baseRoot, candidateRoot, plan) {
  const harnessRoot = plan.harnessVariant === 'base' ? baseRoot : candidateRoot
  const base = verifyApp(baseRoot, harnessRoot, plan, 'base')
  const candidate = verifyApp(candidateRoot, harnessRoot, plan, 'candidate')
  requireEqual(base.harness, candidate.harness, 'Paired harness identity')
  if (plan.calibration === 'manual-aa') {
    requireEqual(base.build, candidate.build, 'A/A application build identity')
    requireEqual(base.wasm, candidate.wasm, 'A/A Wasm build identity')
    requireEqual(base.buildNode, candidate.buildNode, 'A/A build runtime')
  }
}

if (require.main === module) {
  const [command, root = '.', harnessRoot, planFile, variant] =
    process.argv.slice(2)
  if (command === 'resolve') {
    const plan = resolvePlan(
      root,
      process.env.GITHUB_EVENT_NAME,
      JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
      process.env.GITHUB_SHA
    )
    writeJson('comparison-plan.json', plan)
    const outputs = {
      base_commit: plan.baseCommit,
      candidate_commit: plan.candidateCommit,
      pr_head_commit: plan.prHeadCommit ?? '',
      harness_commit: plan.harnessCommit,
      harness_source: plan.harnessSource,
      harness_variant: plan.harnessVariant,
      calibration_fault: plan.calibrationFault,
      build_matrix: JSON.stringify({
        include: ['base', 'candidate'].map((variant) => ({
          variant,
          commit: expectedSource(plan, variant),
        })),
      }),
    }
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}\n`)
        .join('')
    )
  } else if (command === 'wasm')
    createWasmManifest(root, {
      node: process.version,
      rust: execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim(),
      wasmPack: execFileSync('wasm-pack', ['--version'], {
        encoding: 'utf8',
      }).trim(),
    })
  else if (command === 'prepare')
    prepare(root, harnessRoot, readPlan(planFile), variant)
  else if (command === 'manifest')
    createAppManifest(root, harnessRoot, readPlan(planFile), variant)
  else if (command === 'verify')
    verifyApp(root, harnessRoot, readPlan(planFile), variant)
  else if (command === 'verify-pair')
    verifyPair(root, harnessRoot, readPlan(planFile))
  else throw new Error('Unknown build comparison command')
}

module.exports = {
  INSTRUMENTATION,
  resolvePlan,
  readPlan,
  treeHash,
  prepare,
  createAppManifest,
  verifyApp,
  verifyPair,
  createWasmManifest,
}
