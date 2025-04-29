// These tests are meant to simply test starting and stopping the electron
// application, check it can make it to the project pane, and nothing more.
// It also tests our test wrappers are working.
// Additionally this serves as a nice minimal example.
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Open the application', () => {
  test('see the project view', async ({ page, context }) => {
    await expect(page.getByTestId('home-section')).toBeVisible()
  })
})
