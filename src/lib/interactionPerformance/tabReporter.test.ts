import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { JSONReport } from '@playwright/test/reporter'
import {
  COMPARISON_ACTIONS,
  COMPARISON_PLAN,
  COMPARISON_WARM_CYCLES,
  compareInteractions,
} from '@e2e/performance/comparison'
import type {
  ComparisonSession,
  InteractionComparison,
} from '@e2e/performance/comparison'
import {
  COMPARISON_PROBES,
  reportComparisonRun,
} from '@e2e/performance/comparison-report'
import type { ComparisonAttempt } from '@e2e/performance/comparison-report'
import { interactions } from '@src/lib/interactionPerformance/definitions'
import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type {
  InteractionSample,
  InteractionSnapshot,
} from '@src/lib/interactionPerformance/types'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const snapshot: InteractionSnapshot = {
  registered: [
    {
      id: 'test.open',
      testId: 'open',
      budgetMs: 150,
      outcome: 'Open',
    },
  ],
  samples: [
    {
      sequence: 1,
      id: 'test.open',
      targetTag: 'button',
      startTime: 1000,
      renderOpportunityMs: 200,
      outcomeMs: 225,
      eventTiming: null,
      status: 'complete',
    },
  ],
  droppedSamples: 0,
  droppedPointerEvents: 0,
  visibilityInterrupted: false,
}
const measurement = {
  snapshot,
  report: reportInteractions(snapshot, { 'test.open': 1 }),
}
const summary = 'Outcome maximum: 225 ms; retained diagnostic sample.'

function comparisonSessions(delayMs = 0): ComparisonSession[] {
  return COMPARISON_PLAN.map(
    (session): ComparisonSession => ({
      ...session,
      snapshot: {
        registered: Object.values(interactions),
        droppedSamples: 0,
        droppedPointerEvents: 0,
        visibilityInterrupted: false,
        samples: Array.from(
          { length: COMPARISON_WARM_CYCLES + 1 },
          (_, cycle) =>
            COMPARISON_ACTIONS[session.context].map(
              (id, action): InteractionSample => {
                const sequence =
                  cycle * COMPARISON_ACTIONS[session.context].length +
                  action +
                  1
                const durationMs =
                  80 + (session.variant === 'candidate' ? delayMs : 0)
                return {
                  sequence,
                  id,
                  targetTag: 'button',
                  startTime: sequence * 1000,
                  renderOpportunityMs: 16,
                  outcomeMs: durationMs,
                  eventTiming: {
                    durationMs,
                    inputDelayMs: 4,
                    processingMs: 8,
                    presentationDelayMs: durationMs - 12,
                  },
                  status: 'complete',
                }
              }
            )
        ).flat(),
      },
    })
  )
}

function comparisonWithCandidateDelay(delayMs = 0): InteractionComparison {
  return compareInteractions(comparisonSessions(delayMs))
}

function completeRun(delayFirstClose = false): ComparisonAttempt[] {
  const attempts = comparisonSessions().map(
    ({ snapshot: initialSnapshot, ...comparison }): ComparisonAttempt => {
      // Browser timestamps and durations retain fractional precision in the
      // actual artifact. Integer-only fixtures substantially understate its size.
      const snapshot = {
        ...initialSnapshot,
        samples: initialSnapshot.samples.map((sample) => {
          const delay =
            delayFirstClose &&
            comparison.variant === 'candidate' &&
            sample.id === interactions.commandPaletteClose.id &&
            sample.sequence === 2
              ? 64
              : 0
          return {
            ...sample,
            startTime: sample.startTime + 0.12345678901234,
            renderOpportunityMs: 16.12345678901234,
            outcomeMs: 80.12345678901234,
            eventTiming: {
              durationMs: 80.12345678901234 + delay,
              inputDelayMs: 4.12345678901234,
              processingMs: 8.12345678901234,
              presentationDelayMs: 67.87654321098765 + delay,
            },
          }
        }),
      }
      return {
        testId: `${comparison.block}/${comparison.variant}/${comparison.context}`,
        project: 'comparison',
        status: 'passed',
        expectedStatus: 'passed',
        retry: 0,
        repeatIndex: 0,
        measurements: [
          JSON.stringify({
            metadata: {
              scenario: `comparison.${comparison.context}`,
              comparison,
              calibrationFault: 'none',
            },
            snapshot,
            report: reportInteractions(
              snapshot,
              Object.fromEntries(
                COMPARISON_ACTIONS[comparison.context].map((id) => [
                  id,
                  COMPARISON_WARM_CYCLES + 1,
                ])
              )
            ),
          }),
        ],
      }
    }
  )
  for (const project of ['harness-base', 'harness-candidate']) {
    for (const scenario of COMPARISON_PROBES) {
      attempts.push({
        testId: scenario,
        project,
        status: 'passed',
        expectedStatus: 'passed',
        retry: 0,
        repeatIndex: 0,
        measurements: [
          JSON.stringify({
            ...measurement,
            metadata: { scenario, calibrationFault: 'none' },
          }),
        ],
      })
    }
  }
  return attempts
}

interface CapturedRequest {
  url: string | undefined
  apiKey: string | string[] | undefined
  body: unknown
  bytes: number
  responseStatus: number
}

async function runReporter({
  comparison,
  failFirstRepeat = false,
  responseStatus = 201,
  responseBlock = false,
  headRef = 'test-branch',
  list = false,
  eventName = 'pull_request',
  measurementBodies,
  maximumRequestBytes = Number.POSITIVE_INFINITY,
}: {
  comparison: unknown
  failFirstRepeat?: boolean
  responseStatus?: number
  responseBlock?: boolean
  headRef?: string
  list?: boolean
  eventName?: 'pull_request' | 'workflow_dispatch'
  measurementBodies?: readonly string[]
  maximumRequestBytes?: number
}) {
  const directory = await mkdtemp(join(tmpdir(), 'interaction-tab-'))
  const requests: CapturedRequest[] = []
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'GET' && request.url === '/received') {
      response.end(JSON.stringify(requests.length))
      return
    }
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      const bytes = Buffer.byteLength(body)
      const status = bytes > maximumRequestBytes ? 413 : responseStatus
      requests.push({
        url: request.url,
        apiKey: request.headers['x-api-key'],
        body: JSON.parse(body),
        bytes,
        responseStatus: status,
      })
      response.statusCode = status
      response.end(
        JSON.stringify({
          status: responseBlock ? 'failed' : 'passed',
          block: responseBlock,
        })
      )
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected a local TCP server address')
    }
    const apiUrl = `http://127.0.0.1:${address.port}`
    const configPath = join(directory, 'playwright.config.cjs')
    const reportPath = join(directory, 'results.json')
    const comparisonDirectory = join(
      directory,
      'test-results',
      'interaction-performance'
    )
    await mkdir(comparisonDirectory, { recursive: true })
    const comparisonPath = join(comparisonDirectory, 'comparison.json')
    const comparisonBody = JSON.stringify(comparison)
    await writeFile(comparisonPath, comparisonBody)
    const measurementPath = join(directory, 'measurements.json')
    await writeFile(measurementPath, JSON.stringify(measurementBodies ?? null))
    await writeFile(
      configPath,
      `module.exports = ${JSON.stringify({
        testDir: directory,
        testMatch: '*.spec.cjs',
        tsconfig: resolve('tsconfig.json'),
        workers: 1,
        retries: 0,
        repeatEach: measurementBodies ? 1 : 2,
        outputDir: join(directory, 'playwright-output'),
        reporter: [
          [resolve('e2e/performance/tab-reporter.ts')],
          ['json', { outputFile: reportPath }],
        ],
      })}`
    )
    // Run real Playwright tests and attachment persistence without a browser.
    // Every test asks the server whether publication has started prematurely.
    await writeFile(
      join(directory, 'scenarios.spec.cjs'),
      `const { test, expect } = require(${JSON.stringify(require.resolve('@playwright/test'))})
const supplied = JSON.parse(require('node:fs').readFileSync(${JSON.stringify(measurementPath)}, 'utf8'))
const scenarios = supplied ? supplied.map((_, index) => 'scenario ' + index) : ['first scenario', 'last scored scenario']
for (const [index, scenario] of scenarios.entries()) {
  test(scenario, async ({}, info) => {
    const received = await fetch(${JSON.stringify(`${apiUrl}/received`)})
    expect(await received.json(), 'TAB must wait until all scoring finishes').toBe(0)
    await info.attach('interaction-measurements', {
      body: supplied?.[index] ?? JSON.stringify({
        ...${JSON.stringify(measurement)},
        metadata: { scenario, repeatIndex: info.repeatEachIndex },
      }),
      contentType: 'application/json',
    })
    await info.attach('interaction-summary', {
      body: ${JSON.stringify(summary)},
      contentType: 'text/plain',
    })
    expect(${failFirstRepeat} && scenario === 'first scenario' && info.repeatEachIndex === 0,
      'Intentional collection failure').toBe(false)
  })
}
`
    )
    const child = spawn(
      process.execPath,
      [
        require.resolve('@playwright/test/cli'),
        'test',
        '--config',
        configPath,
        ...(list ? ['--list'] : []),
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          TAB_API_URL: apiUrl,
          TAB_API_KEY: 'local-test-key',
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_REPOSITORY: 'KittyCAD/modeling-app',
          GITHUB_RUN_ID: '123',
          GITHUB_RUN_ATTEMPT: '2',
          GITHUB_SHA: 'test-sha',
          GITHUB_HEAD_REF: headRef,
          GITHUB_REF_NAME: 'main',
          GITHUB_EVENT_NAME: eventName,
          CI_COMMIT_SHA: 'test-sha',
          CI_PR_NUMBER: '42',
          TARGET: 'desktop',
          RUNNER_OS: 'Linux',
        },
        timeout: 30_000,
        killSignal: 'SIGKILL',
      }
    )
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk
    })
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    const report: JSONReport = JSON.parse(
      await readFile(reportPath, 'utf8').catch((error: unknown) => {
        throw new Error(`Playwright did not write its report: ${output}`, {
          cause: error,
        })
      })
    )
    return {
      requests,
      exitCode,
      output,
      report,
      retainedComparisonBody: await readFile(comparisonPath, 'utf8'),
      originalComparisonBody: comparisonBody,
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}

describe('interaction performance TAB publication', () => {
  it('publishes the complete run below the TAB upload limit and retains its raw artifact', async () => {
    const attempts = completeRun()
    const comparison = reportComparisonRun(attempts)
    expect(comparison.status).toBe('no-regression')
    expect(comparison.collectionErrors).toEqual([])
    const result = await runReporter({
      comparison,
      measurementBodies: attempts.map((attempt) => {
        const body = attempt.measurements[0]
        if (!body) throw new Error('Missing fixture measurement')
        return body
      }),
      maximumRequestBytes: 10 * 1024 * 1024,
    })
    expect(result.exitCode, result.output).toBe(0)
    expect(result.report.stats.expected).toBe(116)
    expect(result.requests).toHaveLength(1)
    expect(
      result.requests[0]?.responseStatus,
      `${result.requests[0]?.bytes} bytes; ${result.output}`
    ).toBe(201)
    expect(result.requests[0]?.bytes).toBeLessThan(256 * 1024)
    expect(result.output).not.toContain('TAB comparison publication failed')
    expect(result.retainedComparisonBody).toBe(result.originalComparisonBody)
    expect(result.requests[0]?.body).toMatchObject({
      status: 'passed',
      artifactName: 'interaction-performance-test-sha-2',
      artifactUrl:
        'https://github.com/KittyCAD/modeling-app/actions/runs/123/attempts/2',
      interactionComparison: {
        status: 'no-regression',
        strata: comparison.strata.map(
          ({ pairs: _pairs, ...stratum }) => stratum
        ),
        captureCount: 116,
        attemptCount: 116,
      },
    })
    const attachments = result.report.suites.flatMap((suite) =>
      suite.specs.flatMap((spec) =>
        spec.tests.flatMap((test) =>
          test.results.flatMap((attempt) =>
            attempt.attachments.filter(
              (attachment) => attachment.name === 'interaction-measurements'
            )
          )
        )
      )
    )
    expect(
      attachments.map((attachment) =>
        Buffer.from(attachment.body ?? '', 'base64').toString('utf8')
      )
    ).toEqual(attempts.map((attempt) => attempt.measurements[0]))
  }, 60_000)

  it('does not let legacy deferred metadata override a regressed comparison', async () => {
    const comparison = reportComparisonRun(completeRun(true))
    expect(comparison.status).toBe('regressed')
    const result = await runReporter({
      comparison: {
        ...comparison,
        enforcement: {
          status: 'deferred',
          deferred: comparison.failures,
          remaining: [],
        },
      },
    })
    expect(result.exitCode, result.output).toBe(0)
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]?.body).toMatchObject({
      status: 'failed',
      interactionComparison: { status: 'regressed' },
    })
    expect(result.retainedComparisonBody).toBe(result.originalComparisonBody)
  }, 60_000)

  it.each([0, 64])(
    'keeps manual calibration with %i ms delay out of PR health',
    async (delayMs) => {
      const comparison = comparisonWithCandidateDelay(delayMs)
      expect(comparison.status).toBe(
        delayMs === 0 ? 'no-regression' : 'regressed'
      )
      const result = await runReporter({
        comparison,
        eventName: 'workflow_dispatch',
      })
      expect(result.exitCode, result.output).toBe(0)
      expect(result.report.stats.expected).toBe(4)
      expect(result.requests.map((request) => request.url)).toEqual([])
    },
    60_000
  )

  it('does not publish an existing comparison artifact while listing tests', async () => {
    const comparison = comparisonWithCandidateDelay()
    expect(comparison.status).toBe('no-regression')
    const result = await runReporter({ comparison, list: true })
    expect(result.exitCode, result.output).toBe(0)
    expect(result.requests).toEqual([])
  }, 60_000)

  it('publishes after scoring, retains every repeat, and cannot override a failure', async () => {
    const comparison = comparisonWithCandidateDelay()
    expect(comparison.status).toBe('no-regression')
    expect(comparison.collectionErrors).toEqual([])
    const result = await runReporter({ comparison, failFirstRepeat: true })
    expect(result.exitCode, result.output).toBe(1)
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]?.url).toBe('/api/results')
    // Playwright can emit a separate spec entry for each repetition.
    const specs = result.report.suites.flatMap((suite) => suite.specs)
    const failedResults = specs
      .filter((spec) => spec.title === 'first scenario')
      .flatMap((spec) => spec.tests.flatMap((test) => test.results))
    expect(failedResults.map((attempt) => attempt.status)).toEqual([
      'failed',
      'passed',
    ])
    expect(
      specs
        .filter((spec) => spec.title === 'last scored scenario')
        .flatMap((spec) =>
          spec.tests.flatMap((test) =>
            test.results.map((attempt) => attempt.status)
          )
        )
    ).toEqual(['passed', 'passed'])
    const attempts = specs.flatMap((spec) =>
      spec.tests.flatMap((test) => test.results)
    )
    const expectedMeasurements = [0, 1].flatMap((repeatIndex) =>
      ['first scenario', 'last scored scenario'].map((scenario) => ({
        test: expect.stringMatching(new RegExp(`${scenario}$`)),
        repeatIndex,
        retry: 0,
        status:
          repeatIndex === 0 && scenario === 'first scenario'
            ? 'failed'
            : 'passed',
      }))
    )
    expect(result.requests[0]?.apiKey).toBe('local-test-key')
    expect(result.requests[0]?.body).toMatchObject({
      project: 'https://github.com/KittyCAD/modeling-app',
      suite: 'interaction-performance',
      test: 'interaction-performance › paired regression comparison',
      branch: 'test-branch',
      commit: 'test-sha',
      status: 'failed',
      duration:
        attempts.reduce((total, attempt) => total + attempt.duration, 0) / 1000,
      message: expect.stringContaining('Intentional collection failure'),
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
      artifactName: 'interaction-performance-test-sha-2',
      artifactUrl:
        'https://github.com/KittyCAD/modeling-app/actions/runs/123/attempts/2',
      logs: expectedMeasurements.map((attempt) => ({
        test: attempt.test,
        repetition: attempt.repeatIndex + 1,
        retry: attempt.retry,
        status: attempt.status,
        durationMs: expect.any(Number),
        errors:
          attempt.status === 'failed'
            ? [expect.stringContaining('Intentional collection failure')]
            : [],
      })),
      interactionComparison: {
        status: comparison.status,
        strata: comparison.strata.map(
          ({ pairs: _pairs, ...stratum }) => stratum
        ),
        failures: comparison.failures,
        targetBreachCount: comparison.targetBreaches.length,
      },
    })
  }, 60_000)

  it('publishes a failed paired decision even when every collection test passes', async () => {
    const comparison = comparisonWithCandidateDelay(64)
    expect(comparison.status).toBe('regressed')
    expect(comparison.collectionErrors).toEqual([])
    const result = await runReporter({ comparison })
    // This child installs only the history reporter. The performance reporter
    // owns the gate; TAB must not change the collector's exit status itself.
    expect(result.exitCode, result.output).toBe(0)
    expect(result.report.stats.expected).toBe(4)
    expect(result.report.stats.unexpected).toBe(0)
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]?.body).toMatchObject({
      test: 'interaction-performance › paired regression comparison',
      status: 'failed',
      interactionComparison: {
        status: comparison.status,
        strata: comparison.strata.map(
          ({ pairs: _pairs, ...stratum }) => stratum
        ),
        failures: comparison.failures,
      },
    })
  }, 60_000)

  it('keeps malformed legacy collection results failed', async () => {
    const result = await runReporter({
      comparison: {
        ...comparisonWithCandidateDelay(),
        collectionErrors: ['Missing capture'],
      },
    })
    expect(result.exitCode, result.output).toBe(0)
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]?.body).toMatchObject({ status: 'failed' })
  }, 60_000)

  it.each([201, 503])(
    'does not retry HTTP %i or apply a TAB blocking response to passing tests',
    async (responseStatus) => {
      const comparison = comparisonWithCandidateDelay()
      expect(comparison.status).toBe('no-regression')
      const result = await runReporter({
        comparison,
        responseStatus,
        responseBlock: true,
        headRef: '',
      })
      expect(result.exitCode, result.output).toBe(0)
      expect(result.requests).toHaveLength(1)
      expect(result.requests[0]?.url).toBe('/api/results')
      expect(result.requests[0]?.body).toMatchObject({
        status: 'passed',
        branch: 'main',
      })
      if (responseStatus === 503) {
        expect(result.output).toContain('HTTP 503')
        expect(
          result.output.match(/TAB comparison publication failed/g)
        ).toHaveLength(1)
      } else {
        expect(result.output).not.toContain('TAB comparison publication failed')
      }
    },
    60_000
  )
})
