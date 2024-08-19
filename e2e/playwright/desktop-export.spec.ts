import { test, expect } from '@playwright/test'
import { getUtils, setupElectron, tearDown } from './test-utils'
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
      await expect(page.getByText(`bracket`)).toBeVisible()

      // open the project
      await page.getByText(`bracket`).click()

      // wait for the project to load
      await expect(page.getByTestId('loading')).toBeAttached()
      await expect(page.getByTestId('loading')).not.toBeAttached({
        timeout: 20_000,
      })

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

      await test.step('Check the export size', async () => {
        await expect
          .poll(
            async () => {
              try {
                const outputGltf = await fsp.readFile('output.gltf')
                return outputGltf.byteLength
              } catch (e) {
                return 0
              }
            },
            { timeout: 15_000 }
          )
          .toBe(477327)

        // clean up output.gltf
        await fsp.rm('output.gltf')
      })
    })

    await test.step('on open of file in file pane', async () => {
      const u = await getUtils(page)
      u.openFilePanel()

      const otherKclButton = page.getByRole('button', { name: 'other.kcl' })

      // Click the file
      await otherKclButton.click()

      // Close the file pane
      u.closeFilePanel()

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
      await expect(alreadyExportingToastMessage).not.toBeVisible()

      // Expect it to succeed.
      await expect(errorToastMessage).not.toBeVisible()
      await expect(engineErrorToastMessage).not.toBeVisible()

      const successToastMessage = page.getByText(`Exported successfully`)
      await expect(successToastMessage).toBeVisible()
      await expect(exportingToastMessage).not.toBeVisible()

      await test.step('Check the export size', async () => {
        await expect
          .poll(
            async () => {
              try {
                const outputGltf = await fsp.readFile('output.gltf')
                return outputGltf.byteLength
              } catch (e) {
                return 0
              }
            },
            { timeout: 15_000 }
          )
          .toBe(108944)

        // clean up output.gltf
        await fsp.rm('output.gltf')
      })
      await electronApp.close()
    })

    await electronApp.close()
  }
)
