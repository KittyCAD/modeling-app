import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter'

class MyAPIReporter implements Reporter {
  private pendingRequests: Promise<void>[] = []
  private allResults: Record<string, any>[] = []
  private blockingResults: Record<string, any>[] = []

  async onEnd(result: FullResult): Promise<void> {
    await Promise.all(this.pendingRequests)
    if (this.allResults.length > 0 && this.blockingResults.length === 0) {
      result.status = 'passed'
      if (!process.env.CI) {
        console.error('TAB API - Marked failures as non-blocking')
      }
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!process.env.TAB_API_URL || !process.env.TAB_API_KEY) {
      return
    }

    const payload = {
      // Required information
      project: 'https://github.com/KittyCAD/modeling-app',
      branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || '',
      commit: process.env.CI_COMMIT_SHA || process.env.GITHUB_SHA || '',
      test: test.titlePath().slice(2).join(' › '),
      status: result.status,
      // Optional information
      duration: result.duration / 1000,
      message: result.error?.stack,
      target: process.env.TARGET || null,
      platform: process.env.RUNNER_OS || process.platform,
      // Extra test and result data
      annotations: test.annotations.map((a) => a.type), // e.g. 'fail' or 'fixme'
      id: test.id, // computed file/test/project ID used for reruns
      retry: result.retry,
      tags: test.tags, // e.g. '@snapshot' or '@skipLocalEngine'
      // Extra environment variables
      CI_COMMIT_SHA: process.env.CI_COMMIT_SHA || null,
      CI_PR_NUMBER: process.env.CI_PR_NUMBER || null,
      GITHUB_BASE_REF: process.env.GITHUB_BASE_REF || null,
      GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME || null,
      GITHUB_HEAD_REF: process.env.GITHUB_HEAD_REF || null,
      GITHUB_REF_NAME: process.env.GITHUB_REF_NAME || null,
      GITHUB_REF: process.env.GITHUB_REF || null,
      GITHUB_SHA: process.env.GITHUB_SHA || null,
      GITHUB_WORKFLOW: process.env.GITHUB_WORKFLOW || null,
      RUNNER_ARCH: process.env.RUNNER_ARCH || null,
    }

    const request = (async () => {
      try {
        const response = await fetch(`${process.env.TAB_API_URL}/api/results`, {
          method: 'POST',
          headers: new Headers({
            'Content-Type': 'application/json',
            'X-API-Key': process.env.TAB_API_KEY || '',
          }),
          body: JSON.stringify(payload),
        })

        if (response.ok) {
          const result = await response.json()
          this.allResults.push(result)
          if (result.block) {
            this.blockingResults.push(result)
          }
        } else {
          const error = await response.json()
          if (!process.env.CI) {
            console.error('TAB API - Failed to send test result:', error)
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!process.env.CI) {
          console.error('TAB API - Unable to send test result:', message)
        }
      }
    })()

    this.pendingRequests.push(request)
  }
}

export default MyAPIReporter
