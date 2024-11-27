import { test, expect } from './zoo-test'
import path from 'path'
import {
  getUtils,
  setupElectron,
  executorInputPath,
  getPlaywrightDownloadDir,
} from './test-utils'
import fsp from 'fs/promises'

test(
  'export works on the first try',
  { tag: '@electron' },
  async ({ page, context }, testInfo) => {
    context.folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await Promise.all([fsp.mkdir(bracketDir, { recursive: true })])
      await Promise.all([
        fsp.copyFile(
          executorInputPath('router-template-slate.kcl'),
          path.join(bracketDir, 'other.kcl')
        ),
        fsp.copyFile(
          executorInputPath('focusrite_scarlett_mounting_braket.kcl'),
          path.join(bracketDir, 'main.kcl')
        ),
      ])
    }),
      await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    await test.step('on open of project', async () => {
      await expect(page.getByText(`bracket`)).toBeVisible()

      // open the project
      await page.getByText(`bracket`).click()

      // expect zero errors in guter
      await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

      // export the model
      const exportButton = page.getByTestId('export-pane-button')
      await expect(exportButton).toBeVisible()

      // Wait for the model to finish loading
      const modelStateIndicator = page.getByTestId(
        'model-state-indicator-execution-done'
      )
      await expect(modelStateIndicator).toBeVisible({ timeout: 60000 })

      const gltfOption = page.getByText('glTF')
      const submitButton = page.getByText('Confirm Export')
      const exportingToastMessage = page.getByText(`Exporting...`)
      const errorToastMessage = page.getByText(`Error while exporting`)
      const engineErrorToastMessage = page.getByText(`Nothing to export`)
      const alreadyExportingToastMessage = page.getByText(`Already exporting`)
      // The open file's name is `main.kcl`, so the export file name should be `main.gltf`
      const exportFileName = `main.gltf`

      // Click the export button
      await exportButton.click()

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
      await expect(alreadyExportingToastMessage).not.toBeVisible()

      // Expect it to succeed.
      await expect(errorToastMessage).not.toBeVisible()
      await expect(engineErrorToastMessage).not.toBeVisible()

      const successToastMessage = page.getByText(`Exported successfully`)
      await expect(successToastMessage).toBeVisible()
      await expect(exportingToastMessage).not.toBeVisible()

      const firstFileFullPath = path.resolve(
        getPlaywrightDownloadDir(page),
        exportFileName
      )
      await test.step('Check the export size', async () => {
        await expect
          .poll(
            async () => {
              try {
                const outputGltf = await fsp.readFile(firstFileFullPath)
                return outputGltf.byteLength
              } catch (e) {
                return 0
              }
            },
            { timeout: 15_000 }
          )
          .toBeGreaterThan(300_000)
      })
    })

    await test.step('on open of file in file pane', async () => {
      const u = await getUtils(page)
      await u.openFilePanel()

      const otherKclButton = page.getByRole('button', { name: 'other.kcl' })

      // Click the file
      await otherKclButton.click()

      // Close the file pane
      await u.closeFilePanel()

      // wait for it to finish executing (todo: make this more robust)
      await page.waitForTimeout(1000)
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
      const alreadyExportingToastMessage = page.getByText(`Already exporting`)
      // The open file's name is `other.kcl`, so the export file name should be `other.gltf`
      const exportFileName = `other.gltf`

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

      const successToastMessage = page.getByText(`Exported successfully`)
      await test.step('Check the success toast message shows and nothing else', async () =>
        Promise.all([
          expect(alreadyExportingToastMessage).not.toBeVisible(),
          expect(errorToastMessage).not.toBeVisible(),
          expect(engineErrorToastMessage).not.toBeVisible(),
          expect(successToastMessage).toBeVisible(),
          expect(exportingToastMessage).not.toBeVisible(),
        ]))

      const secondFileFullPath = path.resolve(
        getPlaywrightDownloadDir(page),
        exportFileName
      )
      await test.step('Check the export size', async () => {
        await expect
          .poll(
            async () => {
              try {
                const outputGltf = await fsp.readFile(secondFileFullPath)
                return outputGltf.byteLength
              } catch (e) {
                return 0
              }
            },
            { timeout: 15_000 }
          )
          .toBeGreaterThan(100_000)
      })
    })
  }
)
