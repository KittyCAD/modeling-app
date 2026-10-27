import fsp from 'fs/promises'

import { expect, test } from '@e2e/playwright/zoo-test'

const cylinder = `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 20mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])
body001 = extrude(region001, length = 10mm)`

test(
  'downloads a slow export after file picker user activation expires',
  { tag: '@web' },
  async ({ page, homePage, scene, editor, cmdBar, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Requires the File System Access API')

    await homePage.goToModelingScene()
    await scene.settled()
    await editor.openPane()
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode('', cylinder)
    )

    await page.evaluate(() => {
      Reflect.set(window, 'playwrightSkipFilePicker', false)
      const originalExport = window.rustContext.export.bind(window.rustContext)
      window.rustContext.export = async (...args) => {
        const files = await originalExport(...args)
        // Wait past Chromium's transient user activation window.
        await new Promise((resolve) => setTimeout(resolve, 6000))
        return files
      }

      const originalPicker = window.showSaveFilePicker.bind(window)
      window.showSaveFilePicker = async (...args) => {
        try {
          return await originalPicker(...args)
        } catch (error) {
          Reflect.set(window, 'savePickerErrorForTest', (error as Error).name)
          throw error
        }
      }
    })

    await page.getByTestId('export-pane-button').click()
    await cmdBar.selectOption({ name: 'STEP', exact: true }).click()
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
    await cmdBar.submit()
    const download = await downloadPromise

    expect(
      await page.evaluate(() => Reflect.get(window, 'savePickerErrorForTest'))
    ).toBe('SecurityError')
    expect(download.suggestedFilename()).toMatch(/\.step$/)
    const outputPath = testInfo.outputPath('model.step')
    await download.saveAs(outputPath)
    expect(await fsp.readFile(outputPath, 'utf8')).toContain('ISO-10303-21;')
    await expect(page.getByText('Exported successfully')).toBeVisible()
    await expect(page.getByText('Error while exporting')).not.toBeVisible()
  }
)
