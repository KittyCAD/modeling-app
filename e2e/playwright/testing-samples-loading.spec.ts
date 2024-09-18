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
    const newSampleName = 'flange-with-patterns'
    const newSampleCode = '// Flange'
    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    const commandOption = page.getByRole('option', { name: 'Open Sample' })
    const commandSampleOption = page.getByRole('option', {
      name: newSampleName,
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
      await commandOption.click()
      await commandSampleOption.click()
      await commandMethodArgButton.click()
      await expect(commandMethodOption('Create new file')).not.toBeVisible()
      await commandMethodOption('Overwrite').click()
      await expect(warningText).toBeVisible()
      await confirmButton.click()

      await expect(codeLocator).toContainText(newSampleCode)
    })
  })

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
      const sampleOneName = 'flange-with-patterns'
      const sampleOneCode = '// Flange'
      const sampleTwoName = 'gear-rack'
      const sampleTwoCode = '// 100mm Gear Rack'
      const projectCard = page.getByRole('link', { name: 'bracket' })
      const commandBarButton = page.getByRole('button', { name: 'Commands' })
      const commandOption = page.getByRole('option', { name: 'Open Sample' })
      const commandSampleOption = (name: string) =>
        page.getByRole('option', {
          name,
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
      const newFile = (name: string) =>
        page.getByRole('listitem').filter({
          has: page.getByRole('button', { name: name + FILE_EXT }),
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
        await expect(newFile(sampleOneName)).not.toBeVisible()
      })

      await test.step(`Load a KCL sample with the command palette`, async () => {
        await commandBarButton.click()
        await commandOption.click()
        await commandSampleOption(sampleOneName).click()
        await expect(overwriteWarning).not.toBeVisible()
        await expect(newFileWarning).toBeVisible()
        await confirmButton.click()
      })

      await test.step(`Ensure we made and opened a new file`, async () => {
        await expect(codeLocator).toContainText(sampleOneCode)
        await expect(newFile(sampleOneName)).toBeVisible()
        await expect(projectMenuButton).toContainText(sampleOneName + FILE_EXT)
      })

      await test.step(`Now overwrite the current file`, async () => {
        await commandBarButton.click()
        await commandOption.click()
        await commandSampleOption(sampleTwoName).click()
        await commandMethodArgButton.click()
        await commandMethodOption.click()
        await expect(commandMethodArgButton).toContainText('overwrite')
        await expect(newFileWarning).not.toBeVisible()
        await expect(overwriteWarning).toBeVisible()
        await confirmButton.click()
      })

      await test.step(`Ensure we overwrote the current file without navigating`, async () => {
        await expect(codeLocator).toContainText(sampleTwoCode)
        await expect(newFile(sampleOneName)).toBeVisible()
        await expect(newFile(sampleTwoName)).not.toBeVisible()
        await expect(projectMenuButton).toContainText(sampleOneName + FILE_EXT)
      })

      await electronApp.close()
    }
  )
})
