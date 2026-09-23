'use strict'

const { spawnSync } = require('node:child_process')
const { mkdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const outputDirectory = 'test-results/native-tools'
const startedAt = Date.now()
const totalTimeoutMs = 90_000
const report = {
  diagnostic: 'native-tools-capabilities',
  calibrationEligible: false,
  traceRecorded: false,
  platform: process.platform,
  nodeVersion: process.versions.node,
  xcodeVersion: null,
  xcodeBuild: null,
  xctraceAvailable: false,
  totalTimeoutMs,
  probes: {},
  templates: {},
  recordFlags: {},
  exportFlags: {},
  missingCapabilities: [],
  passed: false,
}

function probe(name, command, args, timeoutMs) {
  const remainingMs = totalTimeoutMs - (Date.now() - startedAt)
  if (remainingMs <= 0) {
    report.probes[name] = { status: 'failed', errorCategory: 'total-timeout' }
    return ''
  }
  const started = Date.now()
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: Math.min(timeoutMs, remainingMs),
    killSignal: 'SIGKILL',
    maxBuffer: 256 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Tool output can contain paths. Keep it in memory solely for allowlisted
  // capability extraction; never include it or raw errors in the report.
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  let errorCategory = null
  if (result.error?.code === 'ETIMEDOUT') errorCategory = 'timeout'
  else if (result.error?.code === 'ENOENT') errorCategory = 'tool-not-found'
  else if (result.error?.code === 'ENOBUFS') errorCategory = 'output-limit'
  else if (result.error) errorCategory = 'spawn-failed'
  else if (result.status !== 0) {
    if (/requires Xcode|unable to find utility/i.test(text)) {
      errorCategory = 'developer-tool-unavailable'
    } else if (/not permitted|permission denied|not authorized/i.test(text)) {
      errorCategory = 'permission-denied'
    } else {
      errorCategory = 'command-failed'
    }
  }
  report.probes[name] = {
    status: errorCategory === null ? 'completed' : 'failed',
    exitCode: result.status,
    errorCategory,
    timeoutMs,
    elapsedMs: Date.now() - started,
  }
  return errorCategory === null ? text : ''
}

function supportedFlags(text, flags) {
  return Object.fromEntries(
    flags.map((flag) => [
      flag,
      new RegExp(`(^|\\s|\\[)${flag}(?=\\s|[=,\\]\\|]|$)`, 'm').test(text),
    ])
  )
}

function main() {
  mkdirSync(outputDirectory, { recursive: true })
  const version = probe('xcodeVersion', 'xcodebuild', ['-version'], 15_000)
  report.xcodeVersion =
    /^Xcode ([0-9]+(?:\.[0-9]+){0,3})\s*$/m.exec(version)?.[1] ?? null
  report.xcodeBuild =
    /^Build version ([A-Za-z0-9]{1,32})\s*$/m.exec(version)?.[1] ?? null
  const location = probe('findXctrace', 'xcrun', ['--find', 'xctrace'], 10_000)
  report.xctraceAvailable = location.trim().length > 0
  const templates = probe(
    'templates',
    'xcrun',
    ['xctrace', 'list', 'templates'],
    20_000
  )
  report.templates = Object.fromEntries(
    [
      'Game Performance',
      'System Trace',
      'Time Profiler',
      'Metal System Trace',
    ].map((name) => [
      name,
      templates.split('\n').some((line) => line.trim() === name),
    ])
  )
  const record = probe(
    'recordHelp',
    'xcrun',
    ['xctrace', 'help', 'record'],
    15_000
  )
  report.recordFlags = supportedFlags(record, [
    '--attach',
    '--time-limit',
    '--output',
    '--template',
    '--no-prompt',
    '--notify-tracing-started',
  ])
  const exported = probe(
    'exportHelp',
    'xcrun',
    ['xctrace', 'help', 'export'],
    15_000
  )
  report.exportFlags = supportedFlags(exported, [
    '--input',
    '--output',
    '--xpath',
    '--toc',
  ])
  for (const [name, result] of Object.entries(report.probes)) {
    if (result.status !== 'completed')
      report.missingCapabilities.push(`probe:${name}`)
  }
  if (!report.xcodeVersion || !report.xcodeBuild)
    report.missingCapabilities.push('xcode-version')
  if (!report.xctraceAvailable) report.missingCapabilities.push('xctrace')
  for (const group of ['templates', 'recordFlags', 'exportFlags']) {
    for (const [name, supported] of Object.entries(report[group])) {
      if (!supported) report.missingCapabilities.push(`${group}:${name}`)
    }
  }
  report.passed = report.missingCapabilities.length === 0
}

try {
  main()
} catch {
  report.missingCapabilities.push('probe-script-failed')
  report.passed = false
} finally {
  report.elapsedMs = Date.now() - startedAt
  try {
    writeFileSync(
      path.join(outputDirectory, 'capabilities.json'),
      `${JSON.stringify(report, null, 2)}\n`
    )
  } catch {
    report.passed = false
  }
  process.exitCode = report.passed ? 0 : 1
}
