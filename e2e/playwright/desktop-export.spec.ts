import fsp from 'fs/promises'
import path from 'path'

import {
  executorInputPath,
  getPlaywrightDownloadDir,
  getUtils,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test(
  'export works on the first try',
  { tag: ['@electron', '@skipLocalEngine'] },
  async ({ page, context, scene, tronApp }, testInfo) => {
    if (!tronApp) {
      fail()
    }

    await context.folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await Promise.all([fsp.mkdir(bracketDir, { recursive: true })])
      await Promise.all([
        fsp.copyFile(
          executorInputPath('cylinder-inches.kcl'),
          path.join(bracketDir, 'other.kcl')
        ),
        fsp.copyFile(
          executorInputPath('e2e-can-sketch-on-chamfer.kcl'),
          path.join(bracketDir, 'main.kcl')
        ),
      ])
    })
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
        getPlaywrightDownloadDir(tronApp.projectDirName),
        exportFileName
      )
      await test.step('Check the export size', async () => {
        await expect
          .poll(
            async () => {
              try {
                const outputGltf = await fsp.readFile(firstFileFullPath)
                return outputGltf.byteLength
              } catch (error: unknown) {
                void error
                return 0
              }
            },
            { timeout: 15_000 }
          )
          .toBeGreaterThan(30_000)
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

      // FIXME: await scene.waitForExecutionDone() does not work. The modeling indicator stays in -receive-reliable and not execution done
      await page.waitForTimeout(10000)

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
        getPlaywrightDownloadDir(tronApp.projectDirName),
        exportFileName
      )
      await test.step('Check the export size', async () => {
        await expect
          .poll(
            async () => {
              try {
                const outputGltf = await fsp.readFile(secondFileFullPath)
                return outputGltf.byteLength
              } catch (error: unknown) {
                void error
                return 0
              }
            },
            { timeout: 15_000 }
          )
          .toBeGreaterThan(50_000)
      })
    })
  }
)
