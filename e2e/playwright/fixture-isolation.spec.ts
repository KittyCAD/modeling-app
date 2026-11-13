import { test, expect } from '@e2e/playwright/zoo-test'
import { mockCloudStorage } from '@e2e/playwright/lib/cloudStorageFixture'

// These tests intentionally cross a test boundary in one reused Electron context.
test.describe('Electron engine route isolation', { tag: '@desktop' }, () => {
  test.describe.configure({ mode: 'serial' })

  test('installs a filesystem test engine mock', async ({ context, page }) => {
    await mockCloudStorage(context)
    await expect(page.getByTestId('home-header')).toBeVisible()
  })

  test('connects to the engine in the following test', async ({
    homePage,
    scene,
  }) => {
    await homePage.goToModelingScene('route-isolation')
    await scene.settled()
  })
})
