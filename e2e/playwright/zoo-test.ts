/* eslint-disable react-hooks/rules-of-hooks */
import {
  test as playwrightTestFn,
  beforeEach,
  afterEach,
} from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

import { GlassSkeletonRecorder } from 'playwright-glass-skeleton'
import type { Fixtures } from '@e2e/playwright/fixtures/fixtureSetup'
import {
  ElectronZoo,
  fixturesBasedOnProcessEnvPlatform,
} from '@e2e/playwright/fixtures/fixtureSetup'

export { expect } from '@playwright/test'

declare module '@playwright/test' {
  interface BrowserContext {
    folderSetupFn: (
      cb: (dir: string) => Promise<void>
    ) => Promise<{ dir: string }>
  }
  interface Page {
    dir: string
    setBodyDimensions: (dims: {
      width: number
      height: number
    }) => Promise<void>
  }
}

// Each worker spawns a new thread, which will spawn its own ElectronZoo.
// So in some sense there is an implicit pool.
// For example, the variable just beneath this text is reused many times
// *for one worker*.
const electronZooInstance = new ElectronZoo()

// Track whether this is the first run for this worker process
// Mac needs more time for the first window creation
let isFirstRun = true

// Our custom decorated Zoo test object. Makes it easier to add fixtures, and
// switch between web and electron if needed.
const playwrightTestFnWithFixtures_ = playwrightTestFn.extend<{
  tronApp?: ElectronZoo
}>({
  tronApp: [
    async ({}, use, testInfo) => {
      if (process.env.TARGET === 'web') {
        await use(undefined)
        return
      }

      // Create a single timeout for the entire tronApp setup process
      // This will ensure tests fail faster if there's an issue with setup
      // instead of waiting for the full global timeout (120s)
      // First runs need more time especially on Mac for window creation
      const setupTimeout = isFirstRun ? 120_000 : 30_000
      let timeoutId: NodeJS.Timeout | undefined

      const setupPromise = new Promise<void>((resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `tronApp setup timed out after ${setupTimeout}ms${isFirstRun ? ' (first run)' : ' (subsequent run)'}`
            )
          )
        }, setupTimeout)

        // Execute the async setup in a separate function
        const doSetup = async () => {
          try {
            await electronZooInstance.createInstanceIfMissing(testInfo)
            resolve()
          } catch (error) {
            reject(error)
          }
        }

        // Start the setup process
        void doSetup()
      })

      try {
        await setupPromise
        if (timeoutId) clearTimeout(timeoutId)

        // First run is complete at this point
        isFirstRun = false

        await use(electronZooInstance)
        await electronZooInstance.makeAvailableAgain()
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId)
        throw error
      }
    },
    { timeout: 120_000 }, // Keep the global timeout as fallback
  ],
})

const playwrightTestFnWithFixtures__ =
  playwrightTestFnWithFixtures_.extend<Fixtures>(
    fixturesBasedOnProcessEnvPlatform
  )

// Add the Glass Skeleton as a fixture to promise a fresh skeleton state
const test = playwrightTestFnWithFixtures__.extend<{
  glassSkeleton?: GlassSkeletonRecorder
}>({
  glassSkeleton: async ({ page }, use) => {
    const glassSkeleton = process.env.MAKE_GLASS_SKELETON
      ? // These are functions because those properties are late-bound.
        new GlassSkeletonRecorder({
          type: 'playwright',
          page,
          fs: {
            writeFile: fs.writeFile,
            mkdir: fs.mkdir,
          },
          path: {
            resolve: path.resolve,
          },
          resources: [
            {
              protocol: GlassSkeletonRecorder.SupportedProtocol.WebSocket,
              urlRegExpStr: 'wss://api.dev.zoo.dev',
              removeMatchingRegExpStrs: [
                'api-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
              ],
            },
          ],
        })
      : undefined
    await use(glassSkeleton)
  },
})
// These exist because otherwise the page is not navigated to yet.
beforeEach(async ({ glassSkeleton }) => {
  if (glassSkeleton === undefined) return
  await glassSkeleton.start()
})
afterEach(async ({ glassSkeleton }, testInfo) => {
  if (glassSkeleton === undefined) return
  await glassSkeleton.stop()
  void glassSkeleton.save({
    outputDir: path.resolve(testInfo.outputPath(), '..'),
    outputName:
      testInfo.titlePath
        .join('-')
        .toLowerCase()
        .trim()
        .replace(/'"/g, '')
        .replaceAll(' ', '-') + '.bson',
  })
})

export { test }
