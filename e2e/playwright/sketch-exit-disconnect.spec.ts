import { getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Sketch exit after disconnect', { tag: '@desktop' }, () => {
  test.use({ mockApiRoutes: false })

  for (const renderer of ['@localRenderer', '@streamRenderer']) {
    test(
      `exits the disposed sketch and can sketch again after reconnect ${renderer}`,
      { tag: [renderer, '@skipLocalEngine'] },
      async ({ page, homePage, scene, toolbar }) => {
        const utils = await getUtils(page)
        const network = {
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        }
        await homePage.goToModelingScene()
        await scene.settled()
        await toolbar.startSketchOnDefaultPlane('Top plane')
        await expect(toolbar.exitSketchBtn).toBeEnabled()

        try {
          await utils.emulateNetworkConditions({ ...network, offline: true })
          await expect(page.getByTestId(/network-toggle/)).toContainText(
            'Network health (Offline)'
          )
          await expect(toolbar.exitSketchBtn).toBeHidden()
          await expect(toolbar.startSketchBtn).toBeVisible()
        } finally {
          await utils.emulateNetworkConditions({ ...network, offline: false })
        }

        await scene.settled()
        await expect(toolbar.startSketchBtn).toBeEnabled()
        await toolbar.startSketchOnDefaultPlane('Front plane')
        await expect(toolbar.exitSketchBtn).toBeEnabled()
        await toolbar.exitSketch()
      }
    )
  }
})
