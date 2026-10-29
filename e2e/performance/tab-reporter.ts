import { readFile } from 'node:fs/promises'
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'
import { isArray } from '@src/lib/utils'

interface Attempt {
  test: string
  repeatIndex: number
  retry: number
  status: TestResult['status']
  durationMs: number
  errors: string[]
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !isArray(value)
}

function fields(value: unknown, names: readonly string[]) {
  if (!record(value)) return {}
  return Object.fromEntries(names.map((name) => [name, value[name]]))
}

function rows(value: unknown, names: readonly string[]) {
  return isArray(value) ? value.map((row) => fields(row, names)) : []
}

function count(value: unknown) {
  return isArray(value) ? value.length : 0
}

function passed(comparison: Record<string, unknown>) {
  return (
    comparison.status === 'no-regression' &&
    isArray(comparison.collectionErrors) &&
    comparison.collectionErrors.length === 0 &&
    comparison.unavailablePresentationStrata === 0
  )
}

function summarize(comparison: Record<string, unknown>) {
  const key = ['context', 'id', 'phase', 'metric']
  return {
    status: comparison.status,
    unavailablePresentationStrata: comparison.unavailablePresentationStrata,
    collectionErrors: comparison.collectionErrors,
    strata: rows(comparison.strata, [
      ...key,
      'status',
      'completePairs',
      'positivePairs',
      'medianDeltaMs',
      'baseFirstMedianDeltaMs',
      'candidateFirstMedianDeltaMs',
    ]),
    failures: rows(comparison.failures, key),
    targetBreachCount: count(comparison.targetBreaches),
    captureCount: count(comparison.captures),
    attemptCount: count(comparison.attempts),
  }
}

/** Send history after scoring; TAB has no authority over this suite's status. */
export default class InteractionTabReporter implements Reporter {
  private attempts: Attempt[] = []
  private readonly listOnly: boolean

  constructor(options: unknown) {
    this.listOnly =
      typeof options === 'object' &&
      options !== null &&
      '_mode' in options &&
      options._mode === 'list'
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.attempts.push({
      test: test.titlePath().slice(1).join(' › '),
      repeatIndex: test.repeatEachIndex,
      retry: result.retry,
      status: result.status,
      durationMs: result.duration,
      errors: result.errors.map((error) => error.stack ?? error.message ?? ''),
    })
  }

  async onEnd(_result: Readonly<FullResult>) {
    if (this.listOnly) return
    // TAB identifies final results without a run ID. Manual controls and injected
    // faults must not replace the PR comparison or enter its shared health status.
    // Their decisions and raw measurements remain in the GitHub run artifacts.
    if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') return
    const apiUrl = process.env.TAB_API_URL
    const apiKey = process.env.TAB_API_KEY
    if (!apiUrl || !apiKey) return

    const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com'
    const repository = process.env.GITHUB_REPOSITORY ?? 'KittyCAD/modeling-app'
    const runId = process.env.GITHUB_RUN_ID ?? null
    const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? null
    const artifactName = `interaction-performance-${process.env.GITHUB_SHA}-${runAttempt}`

    try {
      const comparison: unknown = JSON.parse(
        await readFile(
          'test-results/interaction-performance/comparison.json',
          'utf8'
        )
      )
      if (!record(comparison) || !('status' in comparison)) {
        throw new Error('Missing comparison status')
      }
      const test = 'interaction-performance › paired regression comparison'

      // Collection passes are not performance passes. Publish the final paired
      // decision as one result. Raw captures, pairs, and attachments remain in
      // the linked artifact; duplicating them here exceeds TAB's upload limit.
      const status =
        _result.status === 'passed' && passed(comparison) ? 'passed' : 'failed'
      const response = await fetch(new URL('/api/results', apiUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          project: `${server}/${repository}`,
          suite: 'interaction-performance',
          test,
          branch:
            process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || '',
          commit: process.env.CI_COMMIT_SHA ?? process.env.GITHUB_SHA ?? '',
          status,
          duration:
            this.attempts.reduce(
              (total, attempt) => total + attempt.durationMs,
              0
            ) / 1000,
          message: this.attempts
            .flatMap((attempt) => attempt.errors)
            .join('\n'),
          target: process.env.TARGET ?? 'desktop',
          platform: process.env.RUNNER_OS ?? process.platform,
          browser: 'chromium',
          GITHUB_RUN_ID: runId,
          GITHUB_RUN_ATTEMPT: runAttempt,
          CI_PR_NUMBER: process.env.CI_PR_NUMBER ?? null,
          artifactName: runId ? artifactName : null,
          artifactUrl: runId
            ? `${server}/${repository}/actions/runs/${runId}/attempts/${runAttempt}`
            : null,
          logs: this.attempts.map((attempt) => ({
            test: attempt.test,
            repetition: attempt.repeatIndex + 1,
            retry: attempt.retry,
            status: attempt.status,
            durationMs: attempt.durationMs,
            errors: attempt.errors,
          })),
          interactionComparison: summarize(comparison),
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      // Drain the response, but never apply TAB's block/status overrides or
      // call /api/share, which updates the shared GitHub status check.
      await response.text()
    } catch (error) {
      console.warn(`TAB comparison publication failed: ${String(error)}`)
    }
  }
}
