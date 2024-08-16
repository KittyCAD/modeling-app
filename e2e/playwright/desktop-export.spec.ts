import { test, expect } from '@playwright/test'
import { setupElectron, tearDown } from './test-utils'
import fsp from 'fs/promises'

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test(
  'export works on the first try',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        await Promise.all([fsp.mkdir(`${dir}/bracket`, { recursive: true })])
        await Promise.all([
          fsp.copyFile(
            'src/wasm-lib/tests/executor/inputs/router-template-slate.kcl',
            `${dir}/bracket/other.kcl`
          ),
          fsp.copyFile(
            'src/wasm-lib/tests/executor/inputs/focusrite_scarlett_mounting_braket.kcl',
            `${dir}/bracket/main.kcl`
          ),
        ])
      },
    })
    await page.setViewportSize({ width: 1200, height: 500 })

    page.on('console', console.log)

    await test.step('on open of project', async () => {
      const fileChooserPromise = page.waitForEvent('filechooser')
      await expect(page.getByText(`bracket`)).toBeVisible()

      // open the project
      await page.getByText(`bracket`).click()

      // wait for the project to load
      await expect(page.getByTestId('loading')).toBeAttached()
      await expect(page.getByTestId('loading')).not.toBeAttached({
        timeout: 20_000,
      })

      // click the export button
      await page.getByRole('button', { name: 'Export' }).click()

      // expect zero errors in guter
      await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

      // export the model
      const exportButton = page.getByTestId('export-pane-button')
      await expect(exportButton).toBeVisible()

      const gltfOption = page.getByText('glTF')
      const submitButton = page.getByText('Confirm Export')
      const exportingToastMessage = page.getByText(`Exporting...`)
      const errorToastMessage = page.getByText(`Error while exporting`)
      const engineErrorToastMessage = page.getByText(`Nothing to export`)

      // Click the export button
      await exportButton.click({ force: true })
      await page.keyboard.press('Enter')

      await expect(gltfOption).toBeVisible()
      await expect(page.getByText('STL')).toBeVisible()

      await page.keyboard.press('Enter')

      // Click the checkbox
      await expect(submitButton).toBeVisible()

      await page.waitForTimeout(500)

      await page.keyboard.press('Enter')

      // Find the toast.
      // Look out for the toast message
      await expect(exportingToastMessage).toBeVisible()

      const fileChooser = await fileChooserPromise
      await fileChooser.setFiles('output.gltf')

      // Expect it to succeed.
      await expect(errorToastMessage).not.toBeVisible()
      await expect(engineErrorToastMessage).not.toBeVisible()

      const successToastMessage = page.getByText(`Exported successfully`)
      await expect(successToastMessage).toBeVisible()
      await expect(exportingToastMessage).not.toBeVisible()
    })

    await test.step('on open of file in file pane', async () => {
      const fileChooserPromise = page.waitForEvent('filechooser')
      // OPen the file pane
      await page.getByRole('button', { name: 'Project Files' }).click()

      // Click the file
      await page.getByRole('button', { name: 'other.kcl' }).click()

      // wait for the file to load
      await expect(page.getByTestId('loading')).toBeAttached()
      await expect(page.getByTestId('loading')).not.toBeAttached({
        timeout: 20_000,
      })

      // click the export button
      await page.getByRole('button', { name: 'Export' }).click()

      // expect zero errors in guter
      await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

      // export the model
      const exportButton = page.getByTestId('export-pane-button')
      await expect(exportButton).toBeVisible()

      const gltfOption = page.getByText('glTF')
      const submitButton = page.getByText('Confirm Export')
      const exportingToastMessage = page.getByText(`Exporting...`)
      const errorToastMessage = page.getByText(`Error while exporting`)
      const engineErrorToastMessage = page.getByText(`Nothing to export`)

      // Click the export button
      await exportButton.click()

      await expect(gltfOption).toBeVisible()
      await expect(page.getByText('STL')).toBeVisible()

      await page.keyboard.press('Enter')

      // Click the checkbox
      await expect(submitButton).toBeVisible()

      await page.keyboard.press('Enter')

      // Find the toast.
      // Look out for the toast message
      await expect(exportingToastMessage).toBeVisible()

      const fileChooser = await fileChooserPromise
      await fileChooser.setFiles('output.gltf')

      // Expect it to succeed.
      await expect(errorToastMessage).not.toBeVisible()
      await expect(engineErrorToastMessage).not.toBeVisible()

      const successToastMessage = page.getByText(`Exported successfully`)
      await expect(successToastMessage).toBeVisible()
      await expect(exportingToastMessage).not.toBeVisible()
    })

    await electronApp.close()
  }
)
