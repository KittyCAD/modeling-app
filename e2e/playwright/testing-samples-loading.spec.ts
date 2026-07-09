import { join } from 'node:path'
import { bracket } from '@e2e/playwright/fixtures/bracket'
import { FILE_EXT } from '@src/lib/constants'

import {
  closeOnboardingModalIfPresent,
  getUtils,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test.describe('Testing loading external models', { tag: '@desktop' }, () => {
  /**
   * Note this test implicitly depends on the KCL sample "parametric-bearing-pillow-block",
   * its title, and its units settings. https://github.com/KittyCAD/kcl-samples/blob/main/parametric-bearing-pillow-block/main.kcl
   */
  // We have no more web tests
  test.fail(
    'Web: should overwrite current code, cannot create new file',
    async ({ editor, context, page, homePage, cmdBar }) => {
      const u = await getUtils(page)
      await test.step('Test setup', async () => {
        await context.addInitScript((code) => {
          window.localStorage.setItem('persistCode', code)
        }, bracket)
        await page.setBodyDimensions({ width: 1200, height: 500 })
        await homePage.goToModelingScene()
      })

      // Locators and constants
      const newSample = {
        file: `pillow-block-bearing${FILE_EXT}`,
        title: 'Pillow Block Bearing',
      }
      const commandBarButton = page.getByRole('button', { name: 'Commands' })
      const samplesCommandOption = page.getByRole('option', {
        name: 'Load external model',
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
      const warningText = page.getByText('Overwrite current file with sample?')

      await test.step('Precondition: check the initial code', async () => {
        await u.openKclCodePanel()
        await editor.scrollToText(bracket.split('\n')[0])
        await editor.expectEditor.toContain(bracket.split('\n')[0])
      })

      await test.step('Load a KCL sample with the command palette', async () => {
        await commandBarButton.click()
        await samplesCommandOption.click()
        await commandSampleOption.click()
        await commandMethodArgButton.click()
        await expect(commandMethodOption('Create new file')).not.toBeVisible()
        await commandMethodOption('Overwrite').click()
        await expect(warningText).toBeVisible()
        await cmdBar.submit()

        await editor.expectEditor.toContain(`// ${newSample.title}`)
      })
    }
  )

  /**
   * Note this test implicitly depends on the KCL samples:
   * "parametric-bearing-pillow-block": https://github.com/KittyCAD/kcl-samples/blob/main/parametric-bearing-pillow-block/main.kcl
   * "gear-rack": https://github.com/KittyCAD/kcl-samples/blob/main/gear-rack/main.kcl
   */
  test('should create new file by default, creates a second file with automatic unique name', async ({
    editor,
    page,
    scene,
    cmdBar,
    toolbar,
    folderSetupFn,
    fs,
  }) => {
    await folderSetupFn(async (dir) => {
      const bracketDir = join(dir, 'bracket')
      await fs.mkdir(bracketDir, { recursive: true })
      await fs.writeFile(
        join(bracketDir, 'main.kcl'),
        new TextEncoder().encode(bracket)
      )
    })
    const u = await getUtils(page)
    const sampleOne = {
      file: `ball-bearing${FILE_EXT}`,
      title: 'Ball Bearing',
      file1: `ball-bearing-1${FILE_EXT}`,
      folderName: 'ball-bearing',
      folderName1: 'ball-bearing-1',
    }
    const projectCard = page.getByRole('link', { name: 'bracket' })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await projectCard.click()
    await scene.settled()

    await test.step('Load a KCL sample with the command palette', async () => {
      await toolbar.loadButton.click()
      await cmdBar.selectOption({ name: 'KCL Samples' }).click()
      await cmdBar.selectOption({ name: sampleOne.title }).click()
    })

    await test.step('Ensure we made and opened a new file', async () => {
      await u.openFilePanel()
      await expect(
        page.getByTestId('file-tree-item').getByText(sampleOne.folderName)
      ).toBeVisible()
    })

    await test.step('Load a KCL sample with the command palette', async () => {
      await toolbar.loadButton.click()
      await cmdBar.selectOption({ name: 'KCL Samples' }).click()
      await cmdBar.selectOption({ name: sampleOne.title }).click()
    })

    await test.step('Ensure we made and opened a new file with a unique name', async () => {
      await u.openFilePanel()
      await expect(
        page.getByTestId('file-tree-item').getByText(sampleOne.folderName1)
      ).toBeVisible()
    })
  })
})

test.describe('Query parameter command', { tag: '@web' }, () => {
  test('should add sample to demo project', async ({
    page,
    toolbar,
    editor,
  }) => {
    await closeOnboardingModalIfPresent(page)

    const sampleTitle = 'Socket Head Cap Screw'
    const sampleSlug = 'socket-head-cap-screw'
    const queryString = `?cmd=add-kcl-file-to-project&groupId=application&projectName=browser&source=kcl-samples&sample=${sampleSlug}/main.kcl`
    await page.goto(page.url() + queryString)

    await toolbar.openPane(DefaultLayoutPaneID.Code)
    await editor.expectEditor.toContain(sampleTitle, { timeout: 30_000 })
  })
})
