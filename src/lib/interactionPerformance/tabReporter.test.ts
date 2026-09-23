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

function comparisonWithCandidateDelay(delayMs = 0): InteractionComparison {
  const sessions = COMPARISON_PLAN.map(
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
  return compareInteractions(sessions)
}

interface CapturedRequest {
  url: string | undefined
  apiKey: string | string[] | undefined
  body: unknown
}

async function runReporter({
  comparison,
  failFirstRepeat = false,
  responseStatus = 201,
  responseBlock = false,
  headRef = 'test-branch',
  list = false,
}: {
  comparison: InteractionComparison
  failFirstRepeat?: boolean
  responseStatus?: number
  responseBlock?: boolean
  headRef?: string
  list?: boolean
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
      requests.push({
        url: request.url,
        apiKey: request.headers['x-api-key'],
        body: JSON.parse(body),
      })
      response.statusCode = responseStatus
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
    await writeFile(
      join(comparisonDirectory, 'comparison.json'),
      JSON.stringify(comparison)
    )
    await writeFile(
      configPath,
      `module.exports = ${JSON.stringify({
        testDir: directory,
        testMatch: '*.spec.cjs',
        tsconfig: resolve('tsconfig.json'),
        workers: 1,
        retries: 0,
        repeatEach: 2,
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
const scenarios = ['first scenario', 'last scored scenario']
for (const scenario of scenarios) {
  test(scenario, async ({}, info) => {
    const received = await fetch(${JSON.stringify(`${apiUrl}/received`)})
    expect(await received.json(), 'TAB must wait until all scoring finishes').toBe(0)
    await info.attach('interaction-measurements', {
      body: JSON.stringify({
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
    return { requests, exitCode, output, report }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}

describe('interaction performance TAB publication', () => {
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
        summary,
        measurement: {
          ...measurement,
          metadata: { scenario, repeatIndex },
        },
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
        measurements: summary,
      })),
      interactionMeasurements: expectedMeasurements,
      interactionComparison: comparison,
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
    expect(result.requests[0]?.body).toMatchObject({ status: 'failed' })
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]?.body).toMatchObject({
      test: 'interaction-performance › paired regression comparison',
      status: 'failed',
      interactionComparison: comparison,
    })
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
