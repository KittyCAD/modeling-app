import { test, expect } from '@e2e/playwright/zoo-test'

const initialCode = `@settings(kclVersion = 1.0)
profile001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
  |> subtract2d(tool = circle(center = [5, 5], radius = 3))`

test('does not select a legacy profile through its hole @localRenderer @web', async ({
  page,
  homePage,
  scene,
  editor,
}) => {
  await page.setBodyDimensions({ width: 1200, height: 800 })
  await homePage.goToModelingScene()
  await scene.settled()
  await scene.waitForExecutionDoneAfter(() =>
    editor.replaceCode('', initialCode)
  )
  await expect
    .poll(() =>
      page.evaluate(() => window.app.singletons.kclManager.diagnostics)
    )
    .toEqual([])
  await editor.closePane()
  await scene.moveCameraTo({ x: 5, y: 5, z: 50 }, { x: 5, y: 5, z: 0 })
  const [clickProfile] = await scene.findFace(0, { visible: true })
  await clickProfile()
  await expect(page.getByTestId('selection-status')).not.toContainText(
    'No selection'
  )
  const [clickHole] = scene.makeMouseHelpers(0.5, 0.5, { format: 'ratio' })
  await clickHole()
  await expect(page.getByTestId('selection-status')).toContainText(
    'No selection'
  )
})
