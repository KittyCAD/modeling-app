import { test, expect } from '@playwright/test'
import { getUtils, setup, setupElectron, tearDown } from './test-utils'
import { bracket } from 'lib/exampleKcl'
import * as fsp from 'fs/promises'
import { join } from 'path'
import { FILE_EXT } from 'lib/constants'

test.beforeEach(async ({ context, page }, testInfo) => {
  await setup(context, page, testInfo)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Testing in-app sample loading', () => {
  /**
   * Note this test implicitly depends on the KCL sample "flange-with-patterns.kcl"
   * and its title. https://github.com/KittyCAD/kcl-samples/blob/main/flange-with-patterns/flange-with-patterns.kcl
   */
  test('Web: should overwrite current code, cannot create new file', async ({
    page,
  }) => {
    const u = await getUtils(page)

    await test.step(`Test setup`, async () => {
      await page.addInitScript((code) => {
        window.localStorage.setItem('persistCode', code)
      }, bracket)
      await page.setViewportSize({ width: 1200, height: 500 })
      await u.waitForAuthSkipAppStart()
    })

    // Locators and constants
    const newSample = {
      file: 'flange-with-patterns' + FILE_EXT,
      title: 'Flange',
    }
    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    const samplesCommandOption = page.getByRole('option', {
      name: 'Open Sample',
    })
    const commandSampleOption = page.getByRole('option', {
      name: newSample.title,
      exact: true,
    })
    const commandMethodArgButton = page.getByRole('button', {
      name: 'Method',
    })
    const commandMethodOption = (name: 'Overwrite' | 'Create new file') =>
      page.getByRole('option', {
        name,
      })
    const warningText = page.getByText('Overwrite current file?')
    const confirmButton = page.getByRole('button', { name: 'Submit command' })
    const codeLocator = page.locator('.cm-content')

    await test.step(`Precondition: check the initial code`, async () => {
      await u.openKclCodePanel()
      await expect(codeLocator).toContainText(bracket.split('\n')[0])
    })

    await test.step(`Load a KCL sample with the command palette`, async () => {
      await commandBarButton.click()
      await samplesCommandOption.click()
      await commandSampleOption.click()
      await commandMethodArgButton.click()
      await expect(commandMethodOption('Create new file')).not.toBeVisible()
      await commandMethodOption('Overwrite').click()
      await expect(warningText).toBeVisible()
      await confirmButton.click()

      await expect(codeLocator).toContainText('// ' + newSample.title)
    })
  })

  /**
   * Note this test implicitly depends on the KCL samples:
   * "flange-with-patterns.kcl": https://github.com/KittyCAD/kcl-samples/blob/main/flange-with-patterns/flange-with-patterns.kcl
   * "gear-rack.kcl": https://github.com/KittyCAD/kcl-samples/blob/main/gear-rack/gear-rack.kcl
   */
  test(
    'Desktop: should create new file by default, optionally overwrite',
    { tag: '@electron' },
    async ({ browserName: _ }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
          const bracketDir = join(dir, 'bracket')
          await fsp.mkdir(bracketDir, { recursive: true })
          await fsp.writeFile(join(bracketDir, 'main.kcl'), bracket, {
            encoding: 'utf-8',
          })
        },
      })
      const u = await getUtils(page)

      // Locators and constants
      const sampleOne = {
        file: 'flange-with-patterns' + FILE_EXT,
        title: 'Flange',
      }
      const sampleTwo = {
        file: 'gear-rack' + FILE_EXT,
        title: '100mm Gear Rack',
      }
      const projectCard = page.getByRole('link', { name: 'bracket' })
      const commandBarButton = page.getByRole('button', { name: 'Commands' })
      const commandOption = page.getByRole('option', { name: 'Open Sample' })
      const commandSampleOption = (name: string) =>
        page.getByRole('option', {
          name,
          exact: true,
        })
      const commandMethodArgButton = page.getByRole('button', {
        name: 'Method',
      })
      const commandMethodOption = page.getByRole('option', {
        name: 'Overwrite',
      })
      const newFileWarning = page.getByText(
        'Create a new file with the example code?'
      )
      const overwriteWarning = page.getByText('Overwrite current file?')
      const confirmButton = page.getByRole('button', { name: 'Submit command' })
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const newlyCreatedFile = (name: string) =>
        page.getByRole('listitem').filter({
          has: page.getByRole('button', { name }),
        })
      const codeLocator = page.locator('.cm-content')

      await test.step(`Test setup`, async () => {
        await page.setViewportSize({ width: 1200, height: 500 })
        await projectCard.click()
        await u.waitForPageLoad()
      })

      await test.step(`Precondition: check the initial code`, async () => {
        await u.openKclCodePanel()
        await expect(codeLocator).toContainText(bracket.split('\n')[0])
        await u.openFilePanel()

        await expect(projectMenuButton).toContainText('main.kcl')
        await expect(newlyCreatedFile(sampleOne.file)).not.toBeVisible()
      })

      await test.step(`Load a KCL sample with the command palette`, async () => {
        await commandBarButton.click()
        await commandOption.click()
        await commandSampleOption(sampleOne.title).click()
        await expect(overwriteWarning).not.toBeVisible()
        await expect(newFileWarning).toBeVisible()
        await confirmButton.click()
      })

      await test.step(`Ensure we made and opened a new file`, async () => {
        await expect(codeLocator).toContainText('// ' + sampleOne.title)
        await expect(newlyCreatedFile(sampleOne.file)).toBeVisible()
        await expect(projectMenuButton).toContainText(sampleOne.file)
      })

      await test.step(`Now overwrite the current file`, async () => {
        await commandBarButton.click()
        await commandOption.click()
        await commandSampleOption(sampleTwo.title).click()
        await commandMethodArgButton.click()
        await commandMethodOption.click()
        await expect(commandMethodArgButton).toContainText('overwrite')
        await expect(newFileWarning).not.toBeVisible()
        await expect(overwriteWarning).toBeVisible()
        await confirmButton.click()
      })

      await test.step(`Ensure we overwrote the current file without navigating`, async () => {
        await expect(codeLocator).toContainText('// ' + sampleTwo.title)
        await expect(newlyCreatedFile(sampleOne.file)).toBeVisible()
        await expect(newlyCreatedFile(sampleTwo.file)).not.toBeVisible()
        await expect(projectMenuButton).toContainText(sampleOne.file)
      })

      await electronApp.close()
    }
  )
})
