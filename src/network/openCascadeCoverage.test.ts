import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { CompilationIssue } from '@rust/kcl-lib/bindings/CompilationIssue'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { OpenCascadeCommandManager } from '@src/network/openCascadeCommandManager'
import { OPEN_CASCADE_CIRCLE_EXTRUDE_KCL } from '@src/network/openCascadeProofFixture'

type CoverageScope = 'proof' | 'samples' | 'sample-files' | 'docs' | 'stdlib'

type CoverageItem = {
  source: CoverageScope
  name: string
  code: string
  path?: string
}

type CoverageStatus = 'ok' | 'parse-error' | 'unsupported' | 'error'

type CoverageResult = {
  item: CoverageItem
  status: CoverageStatus
  message?: string
}

const ROOT_DIR = path.resolve(__dirname, '..', '..')
const DEFAULT_SCOPES: CoverageScope[] = ['proof', 'samples', 'docs', 'stdlib']
const OPEN_CASCADE_SETTINGS: Partial<Configuration> = {
  settings: { modeling: { engine: 'open_cascade' } },
}

describe('OpenCascade KCL coverage', () => {
  it('reports docs and sample coverage against the OpenCascade WASM executor', async () => {
    const corpus = applyEnvironmentFilters(await collectCorpus())
    expect(corpus.length).toBeGreaterThan(0)

    const wasm = await loadAndInitialiseWasmInstance(
      path.join(ROOT_DIR, 'public', 'kcl_wasm_lib_bg.wasm')
    )
    const context = new wasm.Context(createEngineManager(), createFsManager())
    const results: CoverageResult[] = []

    for (const item of corpus) {
      results.push(await executeItem(wasm, context, item))
    }

    printReport(results)

    const proofResult = results.find(
      (result) =>
        result.item.source === 'proof' &&
        result.item.name === 'openCascadeProofFixture'
    )
    if (proofResult) {
      expect(proofResult.status).toBe('ok')
    }

    if (process.env.KCL_OPEN_CASCADE_COVERAGE_EXPECT_ALL === '1') {
      const failures = results.filter((result) => result.status !== 'ok')
      expect(failures, formatFailures(failures)).toHaveLength(0)
    }
  })
})

async function executeItem(
  wasm: ModuleType,
  context: InstanceType<ModuleType['Context']>,
  item: CoverageItem
): Promise<CoverageResult> {
  let ast: Node<Program>
  try {
    ast = parseKcl(wasm, item)
  } catch (error) {
    return {
      item,
      status: 'parse-error',
      message: stringifyError(error),
    }
  }

  try {
    await context.execute(
      JSON.stringify(ast),
      item.path,
      JSON.stringify(OPEN_CASCADE_SETTINGS)
    )
    return { item, status: 'ok' }
  } catch (error) {
    const message = stringifyError(error)
    return {
      item,
      status: isUnsupportedOpenCascadeError(message) ? 'unsupported' : 'error',
      message,
    }
  }
}

function parseKcl(wasm: ModuleType, item: CoverageItem): Node<Program> {
  const [program, issues]: [Node<Program>, CompilationIssue[]] =
    wasm.parse_wasm(item.code)
  const errors = issues.filter((issue) => issue.severity !== 'Warning')
  if (errors.length > 0) {
    throw new Error(
      errors.map((issue) => issue.message || JSON.stringify(issue)).join('\n')
    )
  }
  return program
}

function createEngineManager() {
  const openCascadeCommandManager = new OpenCascadeCommandManager()

  return {
    openCascadeCommandManager,
    fireModelingCommandFromWasm() {},
    sendModelingCommandFromWasm() {
      return Promise.resolve(new Uint8Array())
    },
    startNewSession() {
      return Promise.resolve()
    },
  }
}

function createFsManager() {
  return {
    async readFile(targetPath: string) {
      return fs.readFile(resolveFsPath(targetPath))
    },
    async exists(targetPath: string) {
      try {
        await fs.stat(resolveFsPath(targetPath))
        return true
      } catch {
        return false
      }
    },
    async getAllFiles(targetPath: string) {
      return fs.readdir(resolveFsPath(targetPath))
    },
  }
}

function resolveFsPath(targetPath: string) {
  return path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(ROOT_DIR, targetPath)
}

async function collectCorpus(): Promise<CoverageItem[]> {
  const [samples, docs, stdlib] = await Promise.all([
    collectSamples(),
    collectDocs('docs', path.join(ROOT_DIR, 'docs', 'kcl-lang')),
    collectDocs('stdlib', path.join(ROOT_DIR, 'docs'), [
      'kcl-std',
      'kcl-std-legacy',
      'kcl-std-sketch-solve',
    ]),
  ])

  return [
    {
      source: 'proof',
      name: 'openCascadeProofFixture',
      code: OPEN_CASCADE_CIRCLE_EXTRUDE_KCL,
      path: path.join(
        ROOT_DIR,
        'src',
        'network',
        'openCascadeProofFixture.kcl'
      ),
    },
    ...samples,
    ...(await collectSampleFiles()),
    ...docs,
    ...stdlib,
  ]
}

async function collectSamples(): Promise<CoverageItem[]> {
  const sampleRoot = path.join(ROOT_DIR, 'public', 'kcl-samples')
  const entries = await fs.readdir(sampleRoot, { withFileTypes: true })
  const items: CoverageItem[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const filePath = path.join(sampleRoot, entry.name, 'main.kcl')
    if (!(await fileExists(filePath))) continue
    items.push({
      source: 'samples',
      name: `public/kcl-samples/${entry.name}/main.kcl`,
      code: await fs.readFile(filePath, 'utf8'),
      path: filePath,
    })
  }

  return items.sort((a, b) => a.name.localeCompare(b.name))
}

async function collectSampleFiles(): Promise<CoverageItem[]> {
  const sampleRoot = path.join(ROOT_DIR, 'public', 'kcl-samples')
  const files = await kclFiles(sampleRoot)

  return files
    .filter((filePath) => path.basename(filePath) !== 'main.kcl')
    .sort((a, b) => a.localeCompare(b))
    .reduce<Promise<CoverageItem[]>>(async (itemsPromise, filePath) => {
      const items = await itemsPromise
      items.push({
        source: 'sample-files',
        name: path.relative(ROOT_DIR, filePath),
        code: await fs.readFile(filePath, 'utf8'),
        path: filePath,
      })
      return items
    }, Promise.resolve([]))
}

async function collectDocs(
  source: Exclude<CoverageScope, 'proof' | 'samples' | 'sample-files'>,
  root: string,
  includeDirs?: string[]
): Promise<CoverageItem[]> {
  const files = await markdownFiles(root, includeDirs)
  const items: CoverageItem[] = []

  for (const filePath of files) {
    const markdown = await fs.readFile(filePath, 'utf8')
    const examples = extractKclFences(markdown)
    examples.forEach((code, index) => {
      const relative = path.relative(ROOT_DIR, filePath)
      items.push({
        source,
        name: `${relative}#kcl-${index + 1}`,
        code,
        path: path.join(
          ROOT_DIR,
          '.generated',
          'opencascade-coverage',
          `${relative.replaceAll(path.sep, '__')}__${index + 1}.kcl`
        ),
      })
    })
  }

  return items.sort((a, b) => a.name.localeCompare(b.name))
}

async function markdownFiles(
  root: string,
  includeDirs?: string[]
): Promise<string[]> {
  const files: string[] = []
  const entries = await fs.readdir(root, { withFileTypes: true })

  for (const entry of entries) {
    if (includeDirs && !includeDirs.includes(entry.name)) continue
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(entryPath)))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entryPath)
    }
  }

  return files
}

async function kclFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const entries = await fs.readdir(root, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await kclFiles(entryPath)))
    } else if (entry.isFile() && entry.name.endsWith('.kcl')) {
      files.push(entryPath)
    }
  }

  return files
}

function extractKclFences(markdown: string): string[] {
  const examples: string[] = []
  const fencePattern = /```([^\n]*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null

  while ((match = fencePattern.exec(markdown)) !== null) {
    const info = match[1].toLowerCase()
    if (!info.split(/\s+/).includes('kcl')) continue
    if (/\b(no_run|norun|ignore|skip)\b/.test(info)) continue
    examples.push(match[2].trim())
  }

  return examples
}

function applyEnvironmentFilters(corpus: CoverageItem[]): CoverageItem[] {
  const scopes = parseScopes(process.env.KCL_OPEN_CASCADE_COVERAGE_SCOPE)
  const filter = process.env.KCL_OPEN_CASCADE_COVERAGE_FILTER
  const limit = Number(process.env.KCL_OPEN_CASCADE_COVERAGE_LIMIT || 0)

  let filtered = corpus.filter((item) => scopes.includes(item.source))
  if (filter) {
    filtered = filtered.filter((item) => item.name.includes(filter))
  }
  if (Number.isFinite(limit) && limit > 0) {
    filtered = filtered.slice(0, limit)
  }

  return filtered
}

function parseScopes(value: string | undefined): CoverageScope[] {
  if (!value) return DEFAULT_SCOPES

  const scopes = value
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope): scope is CoverageScope =>
      ['proof', 'samples', 'sample-files', 'docs', 'stdlib'].includes(scope)
    )

  return scopes.length > 0 ? scopes : DEFAULT_SCOPES
}

function printReport(results: CoverageResult[]) {
  const bySource = groupBy(results, (result) => result.item.source)
  const byStatus = groupBy(results, (result) => result.status)
  const unsupported = results.filter(
    (result) => result.status === 'unsupported'
  )
  const errors = results.filter((result) => result.status === 'error')
  const parseErrors = results.filter(
    (result) => result.status === 'parse-error'
  )

  console.log('\nOpenCascade KCL coverage')
  console.log(`  total: ${results.length}`)
  console.log(
    `  ok: ${byStatus.ok?.length || 0}, unsupported: ${byStatus.unsupported?.length || 0}, errors: ${byStatus.error?.length || 0}, parse errors: ${byStatus['parse-error']?.length || 0}`
  )
  console.log('  by corpus:')
  for (const [source, sourceResults] of Object.entries(bySource)) {
    const statusCounts = groupBy(sourceResults, (result) => result.status)
    console.log(
      `    ${source}: ${sourceResults.length} total, ${statusCounts.ok?.length || 0} ok, ${statusCounts.unsupported?.length || 0} unsupported, ${statusCounts.error?.length || 0} errors, ${statusCounts['parse-error']?.length || 0} parse errors`
    )
  }

  printExamples(
    '  supported examples',
    results.filter((result) => result.status === 'ok')
  )
  printTopMessages('  top unsupported reasons', unsupported)
  printExamples('  execution errors', errors)
  printExamples('  parse errors', parseErrors)
}

function printExamples(title: string, results: CoverageResult[], limit = 10) {
  if (results.length === 0) return

  console.log(`${title}:`)
  for (const result of results.slice(0, limit)) {
    console.log(`    ${result.item.name}${formatMessage(result.message)}`)
  }
  if (results.length > limit) {
    console.log(`    ... ${results.length - limit} more`)
  }
}

function printTopMessages(
  title: string,
  results: CoverageResult[],
  limit = 10
) {
  if (results.length === 0) return

  const counts = new Map<string, number>()
  for (const result of results) {
    const message = normalizeMessage(result.message)
    counts.set(message, (counts.get(message) || 0) + 1)
  }

  console.log(`${title}:`)
  for (const [message, count] of [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)) {
    console.log(`    ${count}x ${message}`)
  }
}

function groupBy<T, K extends string>(
  values: T[],
  key: (value: T) => K
): Partial<Record<K, T[]>> {
  return values.reduce<Partial<Record<K, T[]>>>((groups, value) => {
    const group = key(value)
    groups[group] ||= []
    groups[group]?.push(value)
    return groups
  }, {})
}

function fileExists(filePath: string) {
  return fs
    .stat(filePath)
    .then((stat) => stat.isFile())
    .catch(() => false)
}

function isUnsupportedOpenCascadeError(message: string) {
  return /OpenCascade engine does not support|OpenCascade proof only supports/i.test(
    message
  )
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const maybeKclError = error as {
      error?: { details?: { msg?: unknown } }
    }
    if (typeof maybeKclError.error?.details?.msg === 'string') {
      return maybeKclError.error.details.msg
    }
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function normalizeMessage(message = '') {
  return message.replace(/\s+/g, ' ').slice(0, 240)
}

function formatMessage(message: string | undefined) {
  return message ? `: ${normalizeMessage(message)}` : ''
}

function formatFailures(failures: CoverageResult[]) {
  return failures
    .map(
      (result) =>
        `${result.status} ${result.item.name}${formatMessage(result.message)}`
    )
    .join('\n')
}
