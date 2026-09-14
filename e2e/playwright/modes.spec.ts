import { expect, test } from '@e2e/playwright/zoo-test'
import { DFM_REVIEW_FEATURE_FLAG } from '@src/lib/constants'

const GDT_COMMANDS = [
  'angularity',
  'annotation',
  'circularity',
  'concentricity',
  'cylindricity',
  'datum',
  'distance',
  'flatness',
  'note',
  'parallelism',
  'perpendicularity',
  'position',
  'profile',
  'runout',
  'straightness',
  'symmetry',
]

test.describe('Registry modes', { tag: ['@web', '@desktop'] }, () => {
  test.beforeEach(async ({ homePage, scene }) => {
    await homePage.goToModelingScene()
    await scene.settled()
  })

  test.describe('without the DFM Review feature', () => {
    test.use({ userFeatures: [] })

    test('does not expose the mode or plugin toggle', async ({ page }) => {
      await expect(page.getByTestId('toolbar')).toHaveAttribute(
        'data-current-mode',
        'modeling'
      )
      await expect(page.locator('option[value="dfm-review"]')).toHaveCount(0)

      await page.getByRole('link', { name: 'Settings' }).last().click()
      await page.getByRole('radio', { name: 'Plugins' }).click()
      await expect(
        page.getByRole('heading', { name: 'DFM Review' })
      ).toHaveCount(0)
      await expect(page.locator('#plugin-toggle-dfm-review')).toHaveCount(0)
    })
  })

  test.describe('with the DFM Review feature', () => {
    test.use({ userFeatures: [DFM_REVIEW_FEATURE_FLAG] })

    test('switches toolbars without replacing the engine stream and safely enters and exits sketch', async ({
      page,
      scene,
      toolbar,
    }) => {
      const mode = page.getByRole('combobox', { name: 'Mode', exact: true })
      const toolbarElement = page.getByTestId('toolbar')
      const video = page.locator('#video-stream')

      await scene.connectionEstablished()
      await expect
        .poll(() => video.evaluate((el: HTMLVideoElement) => !!el.srcObject))
        .toBe(true)
      const engineStream = await video.evaluateHandle(
        (el: HTMLVideoElement) => ({
          video: el,
          media: el.srcObject,
        })
      )
      const expectSameEngineStream = async () => {
        expect(
          await engineStream.evaluate(
            ({ video: originalVideo, media }) =>
              originalVideo === document.getElementById('video-stream') &&
              originalVideo.srcObject === media
          )
        ).toBe(true)
      }

      await test.step('DFM Review exposes every GD&T command on the existing engine scene', async () => {
        await expect(mode).toHaveValue('modeling')
        await mode.selectOption({ label: 'DFM Review' })
        await expect(toolbarElement).toHaveAttribute(
          'data-current-mode',
          'dfm-review'
        )
        await expect(toolbar.startSketchBtn).toHaveCount(0)
        for (const command of GDT_COMMANDS) {
          await expect(
            toolbarElement.getByTestId(`gdt-${command}`)
          ).toBeVisible()
          await expect(
            toolbarElement.getByTestId(`gdt-${command}`)
          ).toBeEnabled()
        }
        await expectSameEngineStream()

        await toolbarElement.getByTestId('gdt-note').click()
        await expect(page.getByTestId('command-name')).toHaveText('GDT Note')
        await page.keyboard.press('Escape')
        await expect(page.getByTestId('command-bar-wrapper')).not.toBeVisible()
      })

      await test.step('Modeling restores the standard tools and keeps the engine stream', async () => {
        await mode.selectOption({ label: 'Modeling' })
        await expect(toolbarElement).toHaveAttribute(
          'data-current-mode',
          'modeling'
        )
        await expect(toolbar.startSketchBtn).toBeEnabled()
        await expectSameEngineStream()
      })

      await test.step('Sketch owns its mode until the sketch is exited', async () => {
        await toolbar.startSketchOnDefaultPlane('Top plane')
        await expect(toolbar.exitSketchBtn).toBeEnabled()
        await expect(mode).toBeDisabled()
        await expect(mode.locator('option:checked')).toHaveText('Sketch')
        await toolbar.exitSketch()
        await expect(mode).toBeEnabled()
        await expect(mode).toHaveValue('modeling')
        await mode.selectOption({ label: 'DFM Review' })
        await expect(toolbarElement).toHaveAttribute(
          'data-current-mode',
          'dfm-review'
        )
      })

      await engineStream.dispose()
    })

    test('plugin settings preserve the active mode until its plugin is disabled', async ({
      page,
      toolbar,
    }) => {
      const mode = page.getByRole('combobox', { name: 'Mode', exact: true })
      await mode.selectOption({ label: 'DFM Review' })

      await test.step('Changing an unrelated plugin preserves DFM Review', async () => {
        await page.getByRole('link', { name: 'Settings' }).last().click()
        await page.getByRole('radio', { name: 'Plugins' }).click()
        const slicerToggle = page.locator('#plugin-toggle-slicer')
        const wasSlicerEnabled = await slicerToggle.isChecked()
        await page.locator('label', { has: slicerToggle }).click()
        await expect(slicerToggle).toBeChecked({ checked: !wasSlicerEnabled })
        await page.getByTestId('settings-close-button').click()

        await expect(mode).toHaveValue('dfm-review')
        await expect(page.getByTestId('toolbar')).toHaveAttribute(
          'data-current-mode',
          'dfm-review'
        )
      })

      await page.getByRole('link', { name: 'Settings' }).last().click()
      await page.getByRole('radio', { name: 'Plugins' }).click()
      const pluginToggle = page.locator('#plugin-toggle-dfm-review')
      const pluginToggleLabel = page.locator('label', { has: pluginToggle })
      await expect(pluginToggle).toBeChecked()
      await pluginToggleLabel.click()
      await expect(pluginToggle).not.toBeChecked()
      await page.getByTestId('settings-close-button').click()

      await expect(page.getByTestId('toolbar')).toHaveAttribute(
        'data-current-mode',
        'modeling'
      )
      await expect(toolbar.startSketchBtn).toBeEnabled()
      await expect(page.locator('option[value="dfm-review"]')).toHaveCount(0)

      await page.getByRole('link', { name: 'Settings' }).last().click()
      await page.getByRole('radio', { name: 'Plugins' }).click()
      await pluginToggleLabel.click()
      await expect(pluginToggle).toBeChecked()
      await page.getByTestId('settings-close-button').click()

      await expect(mode).toHaveValue('modeling')
      await mode.selectOption({ label: 'DFM Review' })
      await expect(page.getByTestId('toolbar')).toHaveAttribute(
        'data-current-mode',
        'dfm-review'
      )
      await expect(page.getByTestId('gdt-flatness')).toBeEnabled()
    })
  })
})
