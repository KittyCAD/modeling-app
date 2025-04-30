/* eslint-disable react-hooks/rules-of-hooks */
import { test as playwrightTestFn } from "@playwright/test";

import type { Fixtures } from "@e2e/playwright/fixtures/fixtureSetup";
import {
  ElectronZoo,
  fixturesBasedOnProcessEnvPlatform,
} from "@e2e/playwright/fixtures/fixtureSetup";

export { expect } from "@playwright/test";

import disabledTests from "@root/disabledTests.json";

declare module "@playwright/test" {
  interface BrowserContext {
    folderSetupFn: (
      cb: (dir: string) => Promise<void>,
    ) => Promise<{ dir: string }>;
  }
  interface Page {
    dir: string;
    setBodyDimensions: (dims: {
      width: number;
      height: number;
    }) => Promise<void>;
  }
}

// Each worker spawns a new thread, which will spawn its own ElectronZoo.
// So in some sense there is an implicit pool.
// For example, the variable just beneath this text is reused many times
// *for one worker*.
const electronZooInstance = new ElectronZoo();

// Track whether this is the first run for this worker process
// Mac needs more time for the first window creation
let isFirstRun = true;

// Our custom decorated Zoo test object. Makes it easier to add fixtures, and
// switch between web and electron if needed.
const playwrightTestFnWithFixtures_ = playwrightTestFn.extend<{
  tronApp?: ElectronZoo;
}>({
  tronApp: [
    async ({}, use, testInfo) => {
      // title: 'Can edit a sketch that has been revolved in the same pipe',
      // titlePath: [
      //   'sketch-tests.spec.ts',
      //   'Sketch tests',
      //   'Can edit a sketch that has been revolved in the same pipe'
      // ],
      // Note: testInfo has title and titlePath
      // We can create a filter here on both of those values if needed to properly skip the test
      if (disabledTests[testInfo.title]) {
        playwrightTestFn.skip();
      }

      if (process.env.PLATFORM === "web") {
        await use(undefined);
        return;
      }

      // Create a single timeout for the entire tronApp setup process
      // This will ensure tests fail faster if there's an issue with setup
      // instead of waiting for the full global timeout (120s)
      // First runs need more time especially on Mac for window creation
      const setupTimeout = isFirstRun ? 120_000 : 30_000;
      let timeoutId: NodeJS.Timeout | undefined;

      const setupPromise = new Promise<void>((resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `tronApp setup timed out after ${setupTimeout}ms${isFirstRun ? " (first run)" : " (subsequent run)"}`,
            ),
          );
        }, setupTimeout);

        // Execute the async setup in a separate function
        const doSetup = async () => {
          try {
            await electronZooInstance.createInstanceIfMissing(testInfo);
            resolve();
          } catch (error) {
            reject(error);
          }
        };

        // Start the setup process
        void doSetup();
      });

      try {
        await setupPromise;
        if (timeoutId) clearTimeout(timeoutId);

        // First run is complete at this point
        isFirstRun = false;

        await use(electronZooInstance);
        await electronZooInstance.makeAvailableAgain();
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        throw error;
      }
    },
    { timeout: 120_000 }, // Keep the global timeout as fallback
  ],
});

const test = playwrightTestFnWithFixtures_.extend<Fixtures>(
  fixturesBasedOnProcessEnvPlatform,
);

export { test };
