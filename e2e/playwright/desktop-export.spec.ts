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
  async ({ page, context, scene, tronApp, cmdBar }, testInfo) => {
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

    await test.step('on open of project', async () => {
      // Open the project
      const projectName = page.getByText(`bracket`)
      await expect(projectName).toBeVisible()
      await projectName.click()
      await scene.settled(cmdBar)
      await page.waitForTimeout(1_000) // wait for panel buttons to be available

      // Expect zero errors in gutter
      await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

      // Click the export button
      const exportButton = page.getByTestId('export-pane-button')
      await expect(exportButton).toBeVisible()
      
      await exportButton.click()
      await page.waitForTimeout(1_000) // wait for export options to be available

      // Select the first format option
      const gltfOption = page.getByText('glTF')
      const exportFileName = `main.gltf` // source file is named `main.kcl`
      await expect(gltfOption).toBeVisible()
      await page.keyboard.press('Enter')

      // Click the checkbox
      const submitButton = page.getByText('Confirm Export')
      await expect(submitButton).toBeVisible()
      await page.waitForTimeout(500)
      await page.keyboard.press('Enter')

      // Look out for the toast message
      const exportingToastMessage = page.getByText(`Exporting...`)
      const alreadyExportingToastMessage = page.getByText(`Already exporting`)
      await expect(exportingToastMessage).toBeVisible()
      await expect(alreadyExportingToastMessage).not.toBeVisible()

      // Expect it to succeed
      const errorToastMessage = page.getByText(`Error while exporting`)
      const engineErrorToastMessage = page.getByText(`Nothing to export`)
      await expect(errorToastMessage).not.toBeVisible()
      await expect(engineErrorToastMessage).not.toBeVisible()

      const successToastMessage = page.getByText(`Exported successfully`)
      await expect(successToastMessage).toBeVisible()
      await expect(exportingToastMessage).not.toBeVisible()

      // Check for the exported file
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

      // Click on the other file
      const otherKclButton = page.getByRole('button', { name: 'other.kcl' })
      await otherKclButton.click()

      // Close the file pane
      await u.closeFilePanel()
      await scene.settled(cmdBar)

      // expect zero errors in guter
      await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

      // Click the export button
      const exportButton = page.getByTestId('export-pane-button')
      await expect(exportButton).toBeVisible()
      await exportButton.click()
      await page.waitForTimeout(1_000) // wait for export options to be available

      // Select the first format option
      const gltfOption = page.getByText('glTF')
      const exportFileName = `other.gltf` // source file is named `other.kcl`
      await expect(gltfOption).toBeVisible()
      await page.keyboard.press('Enter')

      // Click the checkbox
      const submitButton = page.getByText('Confirm Export')
      await expect(submitButton).toBeVisible()
      await page.waitForTimeout(500)
      await page.keyboard.press('Enter')

      // Look out for the toast message
      const exportingToastMessage = page.getByText(`Exporting...`)
      const alreadyExportingToastMessage = page.getByText(`Already exporting`)
      await expect(exportingToastMessage).toBeVisible()
      await expect(alreadyExportingToastMessage).not.toBeVisible()

      // Expect it to succeed
      const errorToastMessage = page.getByText(`Error while exporting`)
      const engineErrorToastMessage = page.getByText(`Nothing to export`)
      await expect(errorToastMessage).not.toBeVisible()
      await expect(engineErrorToastMessage).not.toBeVisible()

      const successToastMessage = page.getByText(`Exported successfully`)
      await expect(successToastMessage).toBeVisible()
      await expect(exportingToastMessage).not.toBeVisible()

      // Check for the exported file=
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
