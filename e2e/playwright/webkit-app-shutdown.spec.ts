import { expect, test } from '@e2e/playwright/zoo-test'

// Temporary application-stage comparison for the shutdown diagnostics branch.
test.describe('WebKit application shutdown probes', { tag: '@web' }, () => {
  test.skip(
    process.env.PLAYWRIGHT_WEBKIT_TEARDOWN_DIAGNOSTICS !== '1',
    'Only run with the temporary shutdown observer'
  )

  test('home page without opening a project', async ({ page, homePage }) => {
    await expect(page).toHaveURL(/\/home(?:[/?#]|$)/)
    await homePage.projectsLoaded()
    await expect(page.getByTestId('stream')).toHaveCount(0)
  })

  test('project with an established engine stream', async ({
    homePage,
    scene,
    toolbar,
  }) => {
    await homePage.goToModelingScene()
    await scene.settled()
    await expect(scene.streamWrapper).toBeVisible()
    await expect(toolbar.startSketchBtn).toBeEnabled()
  })
})
