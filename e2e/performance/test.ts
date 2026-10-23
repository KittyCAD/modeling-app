import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { expect, test as zooTest } from '@e2e/playwright/zoo-test'
import type { ComparisonVariant } from '@e2e/performance/comparison'

export { expect }

export interface PerformanceOptions {
  performanceVariant: ComparisonVariant
}

const SETUP_TIMEOUT = 120_000

export const test = zooTest.extend<PerformanceOptions>({
  performanceVariant: ['candidate', { option: true }],
  tronApp: [
    async ({ performanceVariant, userFeatures }, use, testInfo) => {
      const variable =
        performanceVariant === 'base'
          ? 'INTERACTION_BASE_APP_DIR'
          : 'INTERACTION_CANDIDATE_APP_DIR'
      const configuredDirectory = process.env[variable]
      if (!configuredDirectory && process.env.CI) {
        throw new Error(`${variable} is required for performance tests in CI`)
      }
      const appDirectory = path.resolve(configuredDirectory || process.cwd())
      if (!statSync(appDirectory).isDirectory()) {
        throw new Error(`${variable} must refer to an app directory`)
      }
      const packagePath = path.join(appDirectory, 'package.json')
      if (!statSync(packagePath).isFile()) {
        throw new Error(
          'The performance app directory must contain package.json'
        )
      }

      // Electron's package entry point also applies this override. Reject it
      // here so each variant resolves the runtime installed with its lockfile.
      if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
        throw new Error(
          'Unset ELECTRON_OVERRIDE_DIST_PATH for performance comparisons'
        )
      }
      const executablePath: unknown = createRequire(packagePath)('electron')
      if (
        typeof executablePath !== 'string' ||
        !path.isAbsolute(executablePath) ||
        !statSync(executablePath).isFile()
      ) {
        throw new Error(
          'The performance app must provide an Electron executable'
        )
      }

      const { ElectronZoo } = await import(
        '@e2e/playwright/fixtures/fixtureSetup'
      )
      const app = new ElectronZoo({ appDirectory, executablePath })
      let timeoutId: NodeJS.Timeout | undefined
      let fixtureFailed = false
      let fixtureError: unknown
      try {
        // An explicit deadline unwinds setup so disposal also runs if window
        // creation hangs before Playwright can reach the fixture's use call.
        await Promise.race([
          app.createInstanceIfMissing(testInfo, userFeatures, SETUP_TIMEOUT),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(
                new Error(`Electron setup timed out after ${SETUP_TIMEOUT}ms`)
              )
            }, SETUP_TIMEOUT)
          }),
        ])
        if (timeoutId) clearTimeout(timeoutId)
        await use(app)
      } catch (error) {
        fixtureFailed = true
        fixtureError = error
        throw error
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
        try {
          await app.dispose(testInfo)
        } catch (cleanupError) {
          if (fixtureFailed) {
            throw new AggregateError(
              [fixtureError, cleanupError],
              'Performance fixture failed and Electron cleanup failed'
            )
          }
          throw cleanupError
        }
      }
    },
    { scope: 'test', timeout: SETUP_TIMEOUT },
  ],
})
