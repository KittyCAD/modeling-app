import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'

interface Attempt {
  repeatIndex: number
  retry: number
  status: TestResult['status']
  durationMs: number
  errors: string[]
  attachments: TestResult['attachments']
}

interface Scenario {
  browser: string | null
  attempts: Attempt[]
}

/** Send history after scoring; TAB has no authority over this suite's status. */
export default class InteractionTabReporter implements Reporter {
  private scenarios = new Map<string, Scenario>()

  onTestEnd(test: TestCase, result: TestResult) {
    const name = `interaction-performance › ${test.titlePath().slice(1).join(' › ')}`
    let scenario = this.scenarios.get(name)
    if (!scenario) {
      scenario = {
        browser: test.parent.project()?.use.browserName ?? null,
        attempts: [],
      }
      this.scenarios.set(name, scenario)
    }
    scenario.attempts.push({
      repeatIndex: test.repeatEachIndex,
      retry: result.retry,
      status: result.status,
      durationMs: result.duration,
      errors: result.errors.map((error) => error.stack ?? error.message ?? ''),
      attachments: result.attachments,
    })
  }

  async onEnd(_result: Readonly<FullResult>) {
    const apiUrl = process.env.TAB_API_URL
    const apiKey = process.env.TAB_API_KEY
    if (!apiUrl || !apiKey) return

    const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com'
    const repository = process.env.GITHUB_REPOSITORY ?? 'KittyCAD/modeling-app'
    const runId = process.env.GITHUB_RUN_ID ?? null
    const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? null
    const artifactName = `interaction-performance-${process.env.GITHUB_SHA}-${runAttempt}`

    for (const [test, scenario] of this.scenarios) {
      try {
        const attempts = scenario.attempts.map((attempt) => {
          const measurements = attempt.attachments
            .find(
              (attachment) => attachment.name === 'interaction-measurements'
            )
            ?.body?.toString('utf8')
          const summary = attempt.attachments
            .find((attachment) => attachment.name === 'interaction-summary')
            ?.body?.toString('utf8')
          const measurement: unknown = measurements
            ? JSON.parse(measurements)
            : null
          return {
            repeatIndex: attempt.repeatIndex,
            retry: attempt.retry,
            status: attempt.status,
            durationMs: attempt.durationMs,
            errors: attempt.errors,
            summary:
              summary ?? 'No measurements produced. See the test failure.',
            measurement,
          }
        })
        // TAB finalizes earlier rows for the same test/commit/platform. Publish
        // repetitions together so a later pass cannot hide a failed repetition.
        const status = attempts.some(
          (attempt) => !['passed', 'skipped'].includes(attempt.status)
        )
          ? 'failed'
          : attempts.every((attempt) => attempt.status === 'skipped')
            ? 'skipped'
            : 'passed'
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
              attempts.reduce(
                (total, attempt) => total + attempt.durationMs,
                0
              ) / 1000,
            message: attempts.flatMap((attempt) => attempt.errors).join('\n'),
            target: process.env.TARGET ?? 'desktop',
            platform: process.env.RUNNER_OS ?? process.platform,
            browser: scenario.browser,
            GITHUB_RUN_ID: runId,
            GITHUB_RUN_ATTEMPT: runAttempt,
            CI_PR_NUMBER: process.env.CI_PR_NUMBER ?? null,
            artifactName: runId ? artifactName : null,
            artifactUrl: runId
              ? `${server}/${repository}/actions/runs/${runId}/attempts/${runAttempt}`
              : null,
            logs: attempts.map((attempt) => ({
              repetition: attempt.repeatIndex + 1,
              retry: attempt.retry,
              status: attempt.status,
              measurements: attempt.summary,
            })),
            interactionMeasurements: attempts,
          }),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        // Drain the response, but never apply TAB's block/status overrides or
        // call /api/share, which updates the shared GitHub status check.
        await response.text()
      } catch (error) {
        console.warn(`TAB publication failed for ${test}: ${String(error)}`)
      }
    }
  }
}
