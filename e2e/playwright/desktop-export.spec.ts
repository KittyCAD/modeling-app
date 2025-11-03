import path from 'path'
import fsp from 'fs/promises'

import {
  executorInputPath,
  getPlaywrightDownloadDir,
  getUtils,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test(
  'export works on the first try',
  { tag: ['@desktop', '@macos', '@windows', '@skipLocalEngine'] },
  async ({ page, context, scene, tronApp, cmdBar, toolbar }, testInfo) => {
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

      // Expect zero errors in gutter
      await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

      // Click the export button
      const exportButton = page.getByTestId('export-pane-button')
      await expect(exportButton).toBeVisible()
      await exportButton.click()

      // Select the first format option
      const gltfOption = cmdBar.selectOption({ name: 'glTF' })
      const exportFileName = `main.gltf` // source file is named `main.kcl`
      await expect(gltfOption).toBeVisible()
      await page.keyboard.press('Enter')

      // Click the checkbox
      await cmdBar.submit()

      // Expect it to succeed
      const errorToastMessage = page.getByText(`Error while exporting`)
      const engineErrorToastMessage = page.getByText(`Nothing to export`)
      await expect(errorToastMessage).not.toBeVisible()
      await expect(engineErrorToastMessage).not.toBeVisible()

      const successToastMessage = page.getByText(`Exported successfully`)
      // We only care if one toast popped up, but don't worry if more do.
      await expect(successToastMessage.first()).toBeVisible()

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
      await toolbar.openFile('other.kcl')

      // Close the file pane
      await u.closeFilePanel()
      await scene.settled(cmdBar)

      // Expect zero errors in gutter
      await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

      // Click the export button
      const exportButton = page.getByTestId('export-pane-button')
      await expect(exportButton).toBeVisible()
      await exportButton.click()

      // Select the first format option
      const gltfOption = cmdBar.selectOption({ name: 'glTF' })
      const exportFileName = `other.gltf` // source file is named `other.kcl`
      await expect(gltfOption).toBeVisible()
      await page.keyboard.press('Enter')

      // Click the checkbox
      await cmdBar.submit()

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
      await page.waitForTimeout(1_000)
      const count = await successToastMessage.count()
      await expect(count).toBeGreaterThanOrEqual(1)
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

test(
  'DXF export works from feature tree sketch context menu',
  { tag: ['@desktop', '@macos', '@windows', '@skipLocalEngine'] },
  async ({ page, context, scene, tronApp, cmdBar, toolbar }, testInfo) => {
    if (!tronApp) {
      fail()
    }

    await context.folderSetupFn(async (dir) => {
      const sketchDir = path.join(dir, 'sketch-project')
      await fsp.mkdir(sketchDir, { recursive: true })
      await fsp.writeFile(
        path.join(sketchDir, 'main.kcl'),
        `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-18.26, 13.11])
  |> line(end = [9.86, -32.02])
  |> xLine(length = 18.11)
  |> line(end = [11.44, 33.04])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5)`
      )
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })

    // Open the project
    const projectName = page.getByText(`sketch-project`)
    await expect(projectName).toBeVisible()
    await projectName.click()
    await scene.settled(cmdBar)

    // Expect zero errors in gutter
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    // Close other panes and ensure only feature tree is open
    const u = await getUtils(page)
    await u.closeFilePanel()
    await u.closeDebugPanel()
    await u.closeKclCodePanel()

    // Open the feature tree pane
    await toolbar.openFeatureTreePane()

    // Find the sketch operation in the feature tree
    const sketchNode = page.getByText('sketch001').first()
    await expect(sketchNode).toBeVisible()

    // Right-click to open context menu
    await sketchNode.click({ button: 'right' })

    // Verify that "Export to DXF" option is present and click it
    const dxfExportOption = page.getByTestId('context-menu-export-dxf')
    await expect(dxfExportOption).toBeVisible()
    await dxfExportOption.click()

    // Expect it to succeed - check for various error types
    const errorToastMessage = page.getByText('Failed to export sketch to DXF')
    const generalErrorToastMessage = page.getByText('Error while exporting')
    const engineErrorToastMessage = page.getByText('Nothing to export')
    await expect(errorToastMessage).not.toBeVisible()
    await expect(generalErrorToastMessage).not.toBeVisible()
    await expect(engineErrorToastMessage).not.toBeVisible()

    const successToastMessage = page.getByText('DXF export completed [TEST]')
    await page.waitForTimeout(1_000)
    const count = await successToastMessage.count()
    await expect(count).toBeGreaterThanOrEqual(1)

    // Check for the exported DXF file
    const exportFileName = 'sketch001.dxf'
    const dxfFileFullPath = path.resolve(
      getPlaywrightDownloadDir(tronApp.projectDirName),
      exportFileName
    )

    await test.step('Check the DXF export size', async () => {
      await expect
        .poll(
          async () => {
            try {
              const outputDxf = await fsp.readFile(dxfFileFullPath)
              return outputDxf.byteLength
            } catch (error: unknown) {
              void error
              return 0
            }
          },
          { timeout: 15_000 }
        )
        .toBeGreaterThan(500) // DXF files should have meaningful content
    })
  }
)
