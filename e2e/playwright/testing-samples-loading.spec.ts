import { join } from 'node:path'
import fsSync from 'node:fs'
import { FILE_EXT } from '@src/lib/constants'

import {
  closeOnboardingModalIfPresent,
  getUtils,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

const bracket = fsSync.readFileSync(
  join('public', 'kcl-samples', 'bracket', 'main.kcl'),
  'utf8'
)

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
    const loadSampleFromToolbar = async () => {
      await toolbar.loadButton.click()
      await cmdBar.expectCommandName('Add file to project')
      await expect(page.getByTestId('cmd-bar-arg-name')).toHaveText('source')
      await expect(page.getByTestId('cmd-bar-arg-value')).toHaveAttribute(
        'placeholder',
        'KCL Samples'
      )
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('cmd-bar-arg-name')).toHaveText('sample')
      await cmdBar.selectOption({ name: sampleOne.title }).click()
    }

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await projectCard.click()
    await scene.settled()

    await test.step('Load a KCL sample with the command palette', async () => {
      await loadSampleFromToolbar()
    })

    await test.step('Ensure we made and opened a new file', async () => {
      await u.openFilePanel()
      await expect(
        page.getByTestId('file-tree-item').getByText(sampleOne.folderName)
      ).toBeVisible()
    })

    await test.step('Load a KCL sample with the command palette', async () => {
      await loadSampleFromToolbar()
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
  test('applies the ttc layout without opening the command palette', async ({
    page,
    cmdBar,
  }) => {
    await page.goto('/?cmd=set-layout&groupId=application&layoutId=ttc')

    await expect
      .poll(() =>
        page.evaluate(() => {
          const layout = window.app.layout.get()
          return 'sizes' in layout ? layout.sizes : []
        })
      )
      .toEqual([0, 50, 50])
    await cmdBar.expectState({ stage: 'commandBarClosed' })
  })

  test('creates a current sample in the default project library', async ({
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
    await expect(page).toHaveURL(/socket-head-cap-screw%2Fmain\.kcl$/)
  })
})
