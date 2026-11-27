import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import { doAndWaitForImageDiff } from '@e2e/playwright/lib/imageAssertions'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import type { EngineCommand } from '@src/lang/std/artifactGraph'

// lee: This needs to be replaced by scene.settled() eventually.
export async function waitForPageLoad(page: Page) {
  await expect(page.getByRole('button', { name: 'Start Sketch' })).toBeEnabled({
    timeout: 20_000,
  })
}

export async function sendSceneCommand(page: Page, cmd: EngineCommand) {
  await page.evaluate(async (cmd) => {
    await window.engineCommandManager.sendSceneCommand(cmd)
  }, cmd)
}

// Restore the camera used when a model is initially loaded.
export async function resetView(scene: SceneFixture) {
  if (test.info().tags.includes('@localRenderer')) {
    // Keep the isometric framing used by the projected selections.
    // Plane hiding is deferred after execution. Wait for both the current model
    // and that visibility update so zoom-to-fit frames the model, not the planes.
    await expect
      .poll(
        () =>
          scene.page.evaluate(() => {
            const manager = window.app.singletons.kclManager
            const view = manager.sceneInfra.localRenderer
            return (
              !manager.isExecuting &&
              view?.isLoadedSceneCurrent() &&
              !view.hasVisibleDefaultPlanes
            )
          }),
        { timeout: 30_000 }
      )
      .toBe(true)
    await scene.page.evaluate(() =>
      window.app.singletons.kclManager.sceneInfra.camControls.viewIsometric({
        padding: 0.1,
      })
    )
    return
  }
  // The camera may already face this way, so no image change is guaranteed.
  await scene.moveCameraTo({ x: 0, y: -128, z: 64 }, undefined, {
    waitForImageChange: false,
  })
  await doAndWaitForImageDiff(scene.streamWrapper, async () => {
    await scene.streamWrapper.click({
      button: 'right',
      position: { x: 10, y: 100 },
    })
    await scene.page
      .getByTestId('view-controls-menu')
      .getByRole('button', { name: 'Reset view' })
      .click()
  })
}
