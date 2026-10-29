import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const sculpture = readFileSync(
  path.resolve('e2e/playwright/fixtures/sketch3d/orbital-sculpture.kcl'),
  'utf8'
)

// An attached scene object is insufficient: the production renderer must draw it.
async function expectSpatialFrames(page: Page) {
  await page.evaluate(() => {
    const group =
      window.app.singletons.kclManager.sceneInfra.scene.getObjectByName(
        'sketch3d'
      )
    if (!group?.children.length)
      throw new Error('No spatial geometry in the client scene')
    group.userData.renderedFrames = 0
    for (const shape of group.children) {
      shape.onAfterRender = () => {
        group.userData.renderedFrames++
      }
    }
  })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.app.singletons.kclManager.sceneInfra.scene.getObjectByName(
            'sketch3d'
          )?.userData.renderedFrames ?? 0
      )
    )
    .toBeGreaterThan(1)
}

test.describe('World-space sketch workflow', { tag: '@web' }, () => {
  test('renders the sculpture in modeling mode and edits through the Sketch dropdown without stranding the app', async ({
    page,
    homePage,
    scene,
    editor,
  }) => {
    await page.setBodyDimensions({ width: 1440, height: 900 })
    await homePage.goToModelingScene('spatial-sketch-regression')
    await scene.settled()
    await editor.openPane()
    await editor.replaceCode('', sculpture)
    await scene.settled()
    await expect
      .poll(() =>
        page.evaluate(() => {
          const manager = window.app.singletons.kclManager
          return manager.execState.spatialSketches?.find(
            (o) => o.label === 'observatory'
          )?.kind
        })
      )
      .toMatchObject({
        type: 'Sketch3d',
        degrees_of_freedom: 0,
        segments: { length: 22 },
      })
    await expectSpatialFrames(page)

    const toolbar = page.getByTestId('toolbar')
    await expect(
      toolbar.getByRole('button', { name: '3D sketch', exact: true })
    ).toHaveCount(0)
    await toolbar
      .getByRole('button', { name: 'sketch-modes: open menu', exact: true })
      .click()
    await page.getByTestId('dropdown-sketch3d').click()
    const panel = page.getByRole('dialog', { name: '3D sketch mode' })
    await expect(panel).toBeVisible()
    await expect(
      panel.getByText('Fully constrained', { exact: true })
    ).toBeVisible()
    await panel.getByRole('button', { name: 'Fit sketch', exact: true }).click()

    await panel.getByLabel('3D geometry tool').selectOption('point')
    await panel.getByLabel('Position X', { exact: true }).fill('10')
    await panel.getByLabel('Position Y', { exact: true }).fill('12')
    await panel.getByLabel('Position Z', { exact: true }).fill('20')
    await panel
      .getByRole('button', { name: 'Add geometry', exact: true })
      .click()
    await scene.settled()
    await expect(
      panel.getByText('3 degrees of freedom', { exact: true })
    ).toBeVisible()
    await panel.getByRole('button', { name: 'Undo', exact: true }).click()
    await scene.settled()
    await expect(
      panel.getByText('Fully constrained', { exact: true })
    ).toBeVisible()
    await panel.getByRole('button', { name: 'Redo', exact: true }).click()
    await scene.settled()
    await expect(
      panel.getByText('3 degrees of freedom', { exact: true })
    ).toBeVisible()

    await panel
      .getByRole('button', { name: 'Finish sketch', exact: true })
      .click()
    await expect(panel).toBeHidden()
    await expect(toolbar.getByTestId('sketch')).toBeEnabled()
    await expectSpatialFrames(page)

    // Idle camera interaction previously hid the entire client scene.
    const viewport = await page.getByTestId('client-side-scene').boundingBox()
    if (!viewport) throw new Error('No modeling viewport')
    await page.mouse.move(
      viewport.x + viewport.width * 0.55,
      viewport.y + viewport.height * 0.5
    )
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(
      viewport.x + viewport.width * 0.7,
      viewport.y + viewport.height * 0.6,
      { steps: 12 }
    )
    await expect(page.getByTestId('client-side-scene')).toHaveCSS(
      'opacity',
      '1'
    )
    await page.mouse.up({ button: 'right' })
    await expectSpatialFrames(page)
    await page.reload()
    await scene.settled()
    await expectSpatialFrames(page)
  })
})
