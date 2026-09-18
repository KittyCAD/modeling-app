import type { Page } from '@playwright/test'
import { expect, test } from '@e2e/playwright/zoo-test'
import {
  LEGACY_SKETCH_MODE_FEATURE_FLAG,
  OPFS_CLOUD_FEATURE_FLAG,
} from '@src/lib/constants'

const waitForSettingsIdle = (page: Page) =>
  page.waitForFunction(() =>
    window.app.settings.actor.getSnapshot().matches('idle')
  )

test.describe('Snap to Grid', { tag: '@desktop' }, () => {
  // These sketches are KCL 1.0, so editing them needs the legacy sketch flag.
  test.use({ userFeatures: [LEGACY_SKETCH_MODE_FEATURE_FLAG] })

  test('draws a line with snap to grid turned on', async ({
    page,
    homePage,
    toolbar,
    scene,
    editor,
    context,
  }) => {
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, 'sketch001 = startSketchOn(XZ)')

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()

    await page.waitForTimeout(1000)

    // Ensure Fixed size grid is ON via Command Bar
    const commands = page.getByRole('button', { name: 'Commands' })
    await commands.click()
    await page
      .getByRole('option', {
        name: 'Settings · modeling · fixed size grid',
      })
      .click()
    await page.getByRole('option', { name: 'On', exact: true }).click()

    // Enter the seeded sketch from the Feature Tree
    const op = await toolbar.getFeatureTreeOperation('sketch001', 0)
    await op.dblclick()
    await toolbar.waitUntilSketchingReady()
    await toolbar.closeFeatureTreePane()

    // Ensure the line tool is equipped
    const lineTool = page.getByRole('button', {
      name: 'line Line',
      exact: true,
    })
    if ((await lineTool.getAttribute('aria-pressed')) !== 'true') {
      await page.keyboard.press('l')
    }
    await expect(lineTool).toHaveAttribute('aria-pressed', 'true')

    // Toggle Snap to Grid via hotkey (mod+g)
    await page.keyboard.down('ControlOrMeta')
    await page.keyboard.press('g')
    await page.keyboard.up('ControlOrMeta')

    // Draw a line
    const [clickA] = scene.makeMouseHelpers(0.5, 0.5, { format: 'ratio' })
    const [clickB] = scene.makeMouseHelpers(0.7, 0.3, { format: 'ratio' })

    await page.waitForTimeout(100)
    await clickA()
    await page.waitForTimeout(100)
    await clickB()

    // Check if snapping is working
    await editor.expectEditor.toContain('line(end = [5.25, 3.5])')
  })
})

test.describe(
  'Modern sketch snap to grid',
  { tag: ['@desktop', '@web'] },
  () => {
    test.use({ userFeatures: [OPFS_CLOUD_FEATURE_FLAG] })
    test('snaps solver sketch points to the visible grid with feedback', async ({
      page,
      homePage,
      toolbar,
      scene,
      editor,
    }) => {
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      await expect(toolbar.startSketchBtn).toBeEnabled({ timeout: 15_000 })
      await scene.settled()
      await editor.replaceCode(
        '',
        '@settings(kclVersion = 2.0)\n\nsketch001 = sketch(on = XY) {}'
      )
      await editor.expectEditor.toContain('sketch001')
      await scene.settled()

      const commands = page.getByRole('button', { name: 'Commands' })
      const cameraProjection = await page.evaluate(
        () => window.app.settings.get().modeling.cameraProjection.current
      )
      if (cameraProjection !== 'orthographic') {
        await waitForSettingsIdle(page)
        await commands.click()
        await page
          .getByRole('option', {
            name: 'Settings · modeling · camera projection',
          })
          .click()
        await page.getByRole('option', { name: 'Orthographic' }).click()
        await waitForSettingsIdle(page)
      }
      const fixedSizeGrid = await page.evaluate(
        () => window.app.settings.get().modeling.fixedSizeGrid.current
      )
      if (!fixedSizeGrid) {
        await waitForSettingsIdle(page)
        await commands.click()
        await page
          .getByRole('option', {
            name: 'Settings · modeling · fixed size grid',
          })
          .click()
        await page.getByRole('option', { name: 'On', exact: true }).click()
        await waitForSettingsIdle(page)
      }
      await scene.settled()

      await toolbar.openFeatureTreePane()
      const sketchOperation = await toolbar.getFeatureTreeOperation(
        'sketch001',
        0
      )
      await sketchOperation.dblclick()
      await expect(toolbar.exitSketchBtn).toBeEnabled()
      await toolbar.closeFeatureTreePane()

      const enableSketchMenuItem = async (
        name: string,
        setting: 'showSketchGrid' | 'snapToGrid'
      ) => {
        const isEnabled = () =>
          page.evaluate(
            (setting) => window.app.settings.get().modeling[setting].current,
            setting
          )
        if (await isEnabled()) return

        await waitForSettingsIdle(page)
        const [openSketchMenu] = scene.makeMouseHelpers(0.8, 0.2, {
          format: 'ratio',
        })
        await openSketchMenu({ shouldRightClick: true })
        const item = page
          .getByTestId('view-controls-menu')
          .getByRole('button', { name })
        await expect(item).toBeVisible()
        await item.click()
        await waitForSettingsIdle(page)
        await expect.poll(isEnabled).toBe(true)
      }
      await enableSketchMenuItem('Show Sketch Grid', 'showSketchGrid')
      await enableSketchMenuItem('Snap to Grid', 'snapToGrid')

      const lineTool = page.getByRole('button', {
        name: 'line Line',
        exact: true,
      })
      if ((await lineTool.getAttribute('aria-pressed')) !== 'true') {
        await page.keyboard.press('l')
      }
      await expect(lineTool).toHaveAttribute('aria-pressed', 'true')

      const [clickStart, moveStart] = scene.makeMouseHelpers(0.63, 0.35, {
        format: 'ratio',
      })
      const [clickEnd, moveEnd] = scene.makeMouseHelpers(0.72, 0.58, {
        format: 'ratio',
      })
      await moveStart()
      await expect
        .poll(() =>
          page.evaluate(() => {
            const sketchScene =
              window.app.singletons.kclManager.sceneInfra.scene
            return {
              gridMarkerVisible:
                sketchScene.getObjectByName(
                  'sketch-solve-grid-snapping-preview-sprite'
                )?.visible ?? false,
              constraintBadgeVisible:
                sketchScene.getObjectByName(
                  'sketch-solve-snapping-preview-sprite'
                )?.visible ?? false,
            }
          })
        )
        .toEqual({ gridMarkerVisible: true, constraintBadgeVisible: false })
      await clickStart()
      await moveEnd()
      await clickEnd()

      const getSnappedLineValues = async () => {
        const code = (await editor.codeContent.textContent()) ?? ''
        const line = code.match(
          /(?:line\d*\s*=\s*)?line\(start\s*=\s*\[var\s+(-?\d+(?:\.\d+)?)mm,\s*var\s+(-?\d+(?:\.\d+)?)mm\],\s*end\s*=\s*\[var\s+(-?\d+(?:\.\d+)?)mm,\s*var\s+(-?\d+(?:\.\d+)?)mm\]/
        )
        return line?.slice(1).map(Number) ?? null
      }
      await expect.poll(getSnappedLineValues).not.toBeNull()
      const snappedLineValues = await getSnappedLineValues()
      expect(snappedLineValues).not.toBeNull()

      for (const value of snappedLineValues ?? []) {
        expect(value * 4).toBeCloseTo(Math.round(value * 4), 8)
      }
    })
  }
)

test.describe('Sketch grid settings', { tag: ['@desktop', '@web'] }, () => {
  test.use({ userFeatures: [OPFS_CLOUD_FEATURE_FLAG] })
  test('shows, updates, and persists the modern sketch grid', async ({
    page,
    homePage,
    toolbar,
    scene,
    editor,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await expect(toolbar.startSketchBtn).toBeEnabled({ timeout: 15_000 })
    await scene.settled()
    await editor.replaceCode(
      '',
      '@settings(kclVersion = 2.0)\n\nsketch001 = sketch(on = XY) {}'
    )
    await editor.expectEditor.toContain('sketch001')
    await scene.settled()

    const commands = page.getByRole('button', { name: 'Commands' })
    const setBooleanSetting = async (setting: string, value: 'On' | 'Off') => {
      await waitForSettingsIdle(page)
      await commands.click()
      await page
        .getByRole('option', {
          name: `Settings · modeling · ${setting}`,
        })
        .click()
      await page.getByRole('option', { name: value }).click()
      await waitForSettingsIdle(page)
    }
    const setOrthographicCamera = async () => {
      await waitForSettingsIdle(page)
      await commands.click()
      await page
        .getByRole('option', {
          name: 'Settings · modeling · camera projection',
        })
        .click()
      await page.getByRole('option', { name: 'Orthographic' }).click()
      await waitForSettingsIdle(page)
    }
    const fixedSizeGridEnabled = () =>
      page.evaluate(
        () => window.app.settings.get().modeling.fixedSizeGrid.current
      )
    const sketchGridEnabled = () =>
      page.evaluate(
        () => window.app.settings.get().modeling.showSketchGrid.current
      )

    await setOrthographicCamera()
    await expect
      .poll(() =>
        page.evaluate(
          () => window.app.settings.get().modeling.cameraProjection.current
        )
      )
      .toBe('orthographic')
    await setBooleanSetting('show sketch grid', 'Off')
    await expect.poll(sketchGridEnabled).toBe(false)
    await setBooleanSetting('fixed size grid', 'On')
    await expect.poll(fixedSizeGridEnabled).toBe(true)

    await toolbar.openFeatureTreePane()
    const sketchOperation = await toolbar.getFeatureTreeOperation(
      'sketch001',
      0
    )
    await sketchOperation.dblclick()
    await expect(toolbar.exitSketchBtn).toBeEnabled()
    await toolbar.closeFeatureTreePane()
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.app.singletons.kclManager.sceneInfra.camControls.camera
                .type
          ),
        { timeout: 15_000 }
      )
      .toBe('OrthographicCamera')

    const sketchGridVisible = () =>
      page.evaluate(
        () =>
          window.app.singletons.kclManager.sceneEntitiesManager.axisGroup?.children.find(
            (child) => child.name === 'InfiniteGridRenderer'
          )?.visible
      )
    await expect.poll(sketchGridVisible).toBe(false)

    const [openSketchMenu] = scene.makeMouseHelpers(0.8, 0.2, {
      format: 'ratio',
    })
    await openSketchMenu({ shouldRightClick: true })
    const viewMenu = page.getByTestId('view-controls-menu')
    const showSketchGrid = viewMenu.getByRole('button', {
      name: 'Show Sketch Grid',
    })
    const snapToGrid = viewMenu.getByRole('button', { name: 'Snap to Grid' })
    await expect(showSketchGrid).toBeVisible()
    await expect(snapToGrid).toBeVisible()
    const sketchMenuItemLabels = await viewMenu
      .getByRole('button')
      .allTextContents()
    expect(
      sketchMenuItemLabels.findIndex((label) =>
        label.includes('Show Sketch Grid')
      )
    ).toBe(
      sketchMenuItemLabels.findIndex((label) =>
        label.includes('Snap to Grid')
      ) - 1
    )
    await waitForSettingsIdle(page)
    await showSketchGrid.click()
    await waitForSettingsIdle(page)
    await expect.poll(sketchGridEnabled).toBe(true)
    await expect.poll(sketchGridVisible).toBe(true)

    await page.evaluate(async () => {
      const kclManager = window.app.singletons.kclManager
      const camera = kclManager.sceneInfra.camControls.camera
      if (!('isOrthographicCamera' in camera)) {
        throw new Error('Expected an orthographic sketch camera')
      }
      const pixelsPerBaseUnit =
        kclManager.sceneInfra.getPixelsPerBaseUnit(camera)
      camera.zoom = (camera.zoom / pixelsPerBaseUnit) * 0.000001
      camera.updateProjectionMatrix()
      await kclManager.sceneEntitiesManager.onCamChange()
    })
    await expect.poll(sketchGridVisible).toBe(false)
    await setBooleanSetting('highlight edges', 'Off')
    await expect(toolbar.exitSketchBtn).toBeEnabled()
    await expect.poll(sketchGridVisible).toBe(false)

    await setBooleanSetting('fixed size grid', 'Off')
    await expect.poll(fixedSizeGridEnabled).toBe(false)
    await expect(toolbar.exitSketchBtn).toBeEnabled()
    await expect.poll(sketchGridVisible).toBe(true)

    await setBooleanSetting('highlight edges', 'On')
    await expect(toolbar.exitSketchBtn).toBeEnabled()
    await expect.poll(sketchGridVisible).toBe(true)

    await toolbar.exitSketchBtn.click()
    await expect(toolbar.startSketchBtn).toBeEnabled()
    await page.reload()
    await expect(toolbar.startSketchBtn).toBeEnabled({ timeout: 30_000 })
    await scene.settled()
    await expect.poll(sketchGridEnabled).toBe(true)
    await expect.poll(fixedSizeGridEnabled).toBe(false)

    await toolbar.openFeatureTreePane()
    const reloadedSketchOperation = await toolbar.getFeatureTreeOperation(
      'sketch001',
      0
    )
    await reloadedSketchOperation.dblclick()
    await expect(toolbar.exitSketchBtn).toBeEnabled()
    await expect.poll(sketchGridVisible).toBe(true)
  })
})
