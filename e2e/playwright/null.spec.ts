// These tests are meant to simply test starting and stopping the electron
// application, check it can make it to the project pane, and nothing more.
// It also tests our test wrappers are working.
// Additionally this serves as a nice minimal example.

import { test as testZoo, expect } from './fixtures/fixtureSetup'

testZoo.describe('Open the application', () => {
  testZoo('see the project view', async ({ tronApp: { page, context } }) => {
    await expect(page.getByTestId('home-section')).toBeVisible()
  })
})
