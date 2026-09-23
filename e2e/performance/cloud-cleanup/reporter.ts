import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'

export default class CleanupReporter implements Reporter {
  private tests: {
    status: TestResult['status']
    timeoutMs: number
    durationMs: number
    retry: number
    errorCount: number
    originalDeadlineTimeout: boolean
  }[] = []
  private globalErrorCount = 0

  printsToStdio() {
    return true
  }

  onError() {
    this.globalErrorCount += 1
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.tests.push({
      status: result.status,
      timeoutMs: test.timeout,
      durationMs: result.duration,
      retry: result.retry,
      errorCount: result.errors.length,
      originalDeadlineTimeout:
        result.status === 'timedOut' &&
        test.timeout === 120_000 &&
        result.errors.length === 1 &&
        result.errors[0].message?.includes(
          'Test timeout of 120000ms exceeded.'
        ) === true,
    })
  }

  async onEnd(result: FullResult) {
    let readbackVerified = false
    try {
      const receipt: unknown = JSON.parse(
        await readFile(
          'test-results/cloud-cleanup/cleanup-receipt.json',
          'utf8'
        )
      )
      readbackVerified =
        typeof receipt === 'object' &&
        receipt !== null &&
        'runStartedAtMs' in receipt &&
        typeof receipt.runStartedAtMs === 'number' &&
        receipt.runStartedAtMs >= result.startTime.getTime() &&
        'successfulPostObserved' in receipt &&
        receipt.successfulPostObserved === true &&
        'validationWaitEntered' in receipt &&
        receipt.validationWaitEntered === true &&
        'statusAfterFixtureTeardown' in receipt &&
        receipt.statusAfterFixtureTeardown === 404 &&
        'readbackError' in receipt &&
        receipt.readbackError === false &&
        'fallbackCleanupAttempted' in receipt &&
        receipt.fallbackCleanupAttempted === false
    } catch {
      // Missing or partial evidence is not proof, including a global timeout.
    }
    const report = {
      schemaVersion: 1,
      calibration: false,
      status: result.status,
      durationMs: result.duration,
      globalErrorCount: this.globalErrorCount,
      tests: this.tests,
      cleanupProofValid:
        result.status === 'failed' &&
        this.globalErrorCount === 0 &&
        this.tests.length === 1 &&
        this.tests[0].retry === 0 &&
        this.tests[0].originalDeadlineTimeout &&
        readbackVerified,
    }
    await mkdir('test-results/cloud-cleanup', { recursive: true })
    await writeFile(
      'test-results/cloud-cleanup/result.json',
      JSON.stringify(report, null, 2)
    )
    console.log(JSON.stringify(report))
    // Preserve Playwright's failed status for the deliberate timeout.
  }
}
