import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'

class MyAPIReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult): void {
    const payload = {
      // Required information
      project: 'https://github.com/KittyCAD/modeling-app',
      branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF || '',
      commit: process.env.GITHUB_SHA || '',
      test: test.titlePath().slice(2).join(' › '),
      status: result.status,
      // Optional information
      duration: result.duration / 1000,
      message: result.error?.stack,
      // Extra test and result data
      annotations: test.annotations.map((a) => a.type),
      retries: result.retry,
      // Extra environment variables
      GITHUB_BASE_REF: process.env.GITHUB_BASE_REF || null,
      GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME || null,
      GITHUB_HEAD_REF: process.env.GITHUB_HEAD_REF || null,
      GITHUB_REF_NAME: process.env.GITHUB_REF_NAME || null,
      GITHUB_REF: process.env.GITHUB_REF || null,
      GITHUB_WORKFLOW: process.env.GITHUB_WORKFLOW || null,
      RUNNER_ARCH: process.env.RUNNER_ARCH || null,
      RUNNER_OS: process.env.RUNNER_OS || null,
    }

    if (!process.env.TAB_API_URL || !process.env.TAB_API_KEY) {
      return
    }

    void (async () => {
      try {
        const response = await fetch(`${process.env.TAB_API_URL}/api/results`, {
          method: 'POST',
          headers: new Headers({
            'Content-Type': 'application/json',
            'X-API-Key': process.env.TAB_API_KEY || '',
          }),
          body: JSON.stringify(payload),
        })

        if (!response.ok && !process.env.CI) {
          console.error(
            'TAB API - Failed to send test result:',
            await response.text()
          )
        }
      } catch {
        if (!process.env.CI) {
          console.error('TAB API - Unable to send test result')
        }
      }
    })()
  }
}

export default MyAPIReporter
