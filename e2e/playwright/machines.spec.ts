import { test, expect } from '@playwright/test'
import {
  doExport,
  getUtils,
  Paths,
  setupElectron,
  tearDown,
} from './test-utils'
import fsp from 'fs/promises'

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test(
  'Can export from electron app',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        await fsp.mkdir(`${dir}/bracket`, { recursive: true })
        await fsp.copyFile(
          'src/wasm-lib/tests/executor/inputs/focusrite_scarlett_mounting_braket.kcl',
          `${dir}/bracket/main.kcl`
        )
      },
    })

    await page.setViewportSize({ width: 1200, height: 500 })
    const u = await getUtils(page)

    page.on('console', console.log)
    await electronApp.context().addInitScript(async () => {
      ;(window as any).playwrightSkipFilePicker = true
    })

    const pointOnModel = { x: 630, y: 280 }

    await test.step('Opening the bracket project should load the stream', async () => {
      // expect to see the text bracket
      await expect(page.getByText('bracket')).toBeVisible()

      await page.getByText('bracket').click()

      await expect(page.getByTestId('loading')).toBeAttached()
      await expect(page.getByTestId('loading')).not.toBeAttached({
        timeout: 20_000,
      })

      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).toBeEnabled({
        timeout: 20_000,
      })

      // gray at this pixel means the stream has loaded in the most
      // user way we can verify it (pixel color)
      await expect
        .poll(() => u.getGreatestPixDiff(pointOnModel, [75, 75, 75]), {
          timeout: 10_000,
        })
        .toBeLessThan(10)
    })

    const exportLocations: Array<Paths> = []
    await test.step('export the model as a glTF', async () => {
      exportLocations.push(
        await doExport(
          {
            type: 'gltf',
            storage: 'embedded',
            presentation: 'pretty',
          },
          page,
          true
        )
      )
    })

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

    await electronApp.close()
  }
)
