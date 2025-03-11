import { test, expect } from './zoo-test'
import {
  doExport,
  executorInputPath,
  getUtils,
  isOutOfViewInScrollContainer,
  Paths,
  createProject,
  getPlaywrightDownloadDir,
} from './test-utils'
import fsp from 'fs/promises'
import fs from 'fs'
import path from 'path'
import { DEFAULT_PROJECT_KCL_FILE } from 'lib/constants'

test(
  'projects reload if a new one is created, deleted, or renamed externally',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    let externalCreatedProjectName = 'external-created-project'

    let targetDir = ''

    await context.folderSetupFn(async (dir) => {
      targetDir = dir
      setTimeout(() => {
        const myDir = path.join(dir, externalCreatedProjectName)
        ;(async () => {
          await fsp.mkdir(myDir)
          await fsp.writeFile(
            path.join(myDir, DEFAULT_PROJECT_KCL_FILE),
            'sca ba be bop de day wawa skee'
          )
        })().catch(console.error)
      }, 5000)
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    const projectLinks = page.getByTestId('project-link')

    await projectLinks.first().waitFor()
    await expect(projectLinks).toContainText(externalCreatedProjectName)

    await fsp.rename(
      path.join(targetDir, externalCreatedProjectName),
      path.join(targetDir, externalCreatedProjectName + '1')
    )

    externalCreatedProjectName += '1'
    await expect(projectLinks).toContainText(externalCreatedProjectName)

    await fsp.rm(path.join(targetDir, externalCreatedProjectName), {
      recursive: true,
      force: true,
    })

    await expect(projectLinks).toHaveCount(0)
  }
)

test(
  'click help/keybindings from home page',
  { tag: '@electron' },
  async ({ page }, testInfo) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    // click ? button
    await page.getByTestId('help-button').click()
    await expect(page.getByTestId('keybindings-button')).toBeVisible()
    // Click keyboard shortcuts button.
    await page.getByTestId('keybindings-button').click()
    // Make sure the keyboard shortcuts modal is visible.
    await expect(page.getByText('Enter Sketch Mode')).toBeVisible()
  }
)

test(
  'click help/keybindings from project page',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('focusrite_scarlett_mounting_braket.kcl'),
        path.join(bracketDir, 'main.kcl')
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    // expect to see the text bracket
    await expect(page.getByText('bracket')).toBeVisible()

    await page.getByText('bracket').click()

    await expect(page.getByTestId('loading')).toBeAttached()
    await expect(page.getByTestId('loading')).not.toBeAttached({
      timeout: 20_000,
    })

    // click ? button
    await page.getByTestId('help-button').click()
    await expect(page.getByTestId('keybindings-button')).toBeVisible()
    // Click keyboard shortcuts button.
    await page.getByTestId('keybindings-button').click()
    // Make sure the keyboard shortcuts modal is visible.
    await expect(page.getByText('Enter Sketch Mode')).toBeVisible()
  }
)

test(
  'open a file in a project works and renders, open another file in different project with errors, it should clear the scene',
  { tag: '@electron' },
  async ({ context, page, editor }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('focusrite_scarlett_mounting_braket.kcl'),
        path.join(bracketDir, 'main.kcl')
      )
      const errorDir = path.join(dir, 'broken-code')
      await fsp.mkdir(errorDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('broken-code-test.kcl'),
        path.join(errorDir, 'main.kcl')
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    const u = await getUtils(page)

    page.on('console', console.log)

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
        .poll(() => u.getGreatestPixDiff(pointOnModel, [85, 85, 85]), {
          timeout: 10_000,
        })
        .toBeLessThan(20)
    })

    await test.step('Clicking the logo takes us back to the projects page / home', async () => {
      await page.getByTestId('app-logo').click()

      await expect(page.getByRole('link', { name: 'bracket' })).toBeVisible()
      await expect(page.getByText('broken-code')).toBeVisible()
      await expect(page.getByText('bracket')).toBeVisible()
      await expect(page.getByText('Create project')).toBeVisible()
    })
    await test.step('opening broken code project should clear the scene and show the error', async () => {
      // Go back home.
      await expect(page.getByText('broken-code')).toBeVisible()

      await page.getByText('broken-code').click()

      await page.waitForTimeout(2000)
      await editor.scrollToText(
        "|> line(end = [0, wallMountL], tag = 'outerEdge')"
      )

      // error in guter
      await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

      // error text on hover
      await page.hover('.cm-lint-marker-error')
      const crypticErrorText = `Expected a tag declarator`
      await expect(page.getByText(crypticErrorText).first()).toBeVisible()

      // black pixel means the scene has been cleared.
      await expect
        .poll(() => u.getGreatestPixDiff(pointOnModel, [30, 30, 30]), {
          timeout: 10_000,
        })
        .toBeLessThan(15)
    })
  }
)

test(
  'open a file in a project works and renders, open another file in different project that is empty, it should clear the scene',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('focusrite_scarlett_mounting_braket.kcl'),
        path.join(bracketDir, 'main.kcl')
      )
      const emptyDir = path.join(dir, 'empty')
      await fsp.mkdir(emptyDir, { recursive: true })
      await fsp.writeFile(path.join(emptyDir, 'main.kcl'), '')
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    const u = await getUtils(page)

    page.on('console', console.log)

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
        .poll(() => u.getGreatestPixDiff(pointOnModel, [85, 85, 85]), {
          timeout: 10_000,
        })
        .toBeLessThan(15)
    })

    await test.step('Clicking the logo takes us back to the projects page / home', async () => {
      await page.getByTestId('app-logo').click()

      await expect(page.getByRole('link', { name: 'bracket' })).toBeVisible()
      await expect(page.getByText('empty')).toBeVisible()
      await expect(page.getByText('bracket')).toBeVisible()
      await expect(page.getByText('Create project')).toBeVisible()
    })
    await test.step('opening empty code project should clear the scene', async () => {
      // Go back home.
      await expect(page.getByText('empty')).toBeVisible()

      await page.getByText('empty').click()

      // Ensure the code is empty.
      await expect(u.codeLocator).toContainText('')
      expect(u.codeLocator.innerHTML.length).toBeLessThan(2)

      // planes colors means the scene has been cleared.
      await expect
        .poll(() => u.getGreatestPixDiff(pointOnModel, [92, 53, 53]), {
          timeout: 10_000,
        })
        .toBeLessThan(15)
    })
  }
)

test(
  'open a file in a project works and renders, open empty file, it should clear the scene',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('focusrite_scarlett_mounting_braket.kcl'),
        path.join(bracketDir, 'main.kcl')
      )

      await fsp.writeFile(path.join(bracketDir, 'empty.kcl'), '')
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    const u = await getUtils(page)

    page.on('console', console.log)

    const pointOnModel = { x: 630, y: 280 }

    await test.step('Opening the bracket project should load the stream', async () => {
      // expect to see the text bracket
      await expect(page.getByText('bracket')).toBeVisible()

      await page.getByText('bracket').click()

      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).toBeEnabled({
        timeout: 20_000,
      })

      // gray at this pixel means the stream has loaded in the most
      // user way we can verify it (pixel color)
      await expect
        .poll(() => u.getGreatestPixDiff(pointOnModel, [85, 85, 85]), {
          timeout: 10_000,
        })
        .toBeLessThan(15)
    })
    await test.step('creating a empty file should clear the scene', async () => {
      // open the file pane.
      await page.getByTestId('files-pane-button').click()

      // OPen the other file.
      const file = page.getByRole('button', { name: 'empty.kcl' })
      await expect(file).toBeVisible()

      await file.click()

      // planes colors means the scene has been cleared.
      await expect
        .poll(() => u.getGreatestPixDiff(pointOnModel, [92, 53, 53]), {
          timeout: 10_000,
        })
        .toBeLessThan(15)

      // Ensure the code is empty.
      await expect(u.codeLocator).toContainText('')
      expect(u.codeLocator.innerHTML.length).toBeLessThan(2)
    })
  }
)

test(
  'open a file in a project works and renders, open another file in the same project with errors, it should clear the scene',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('focusrite_scarlett_mounting_braket.kcl'),
        path.join(bracketDir, 'main.kcl')
      )
      await fsp.copyFile(
        executorInputPath('broken-code-test.kcl'),
        path.join(bracketDir, 'broken-code-test.kcl')
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    const u = await getUtils(page)

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
        .poll(() => u.getGreatestPixDiff(pointOnModel, [85, 85, 85]), {
          timeout: 10_000,
        })
        .toBeLessThan(15)
    })
    await test.step('opening broken code file should clear the scene and show the error', async () => {
      // open the file pane.
      await page.getByTestId('files-pane-button').click()

      // Open the other file.
      const file = page.getByRole('button', { name: 'broken-code-test.kcl' })
      await expect(file).toBeVisible()

      await file.click()

      // error in guter
      await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

      // error text on hover
      await page.hover('.cm-lint-marker-error')
      const crypticErrorText = `Expected a tag declarator`
      await expect(page.getByText(crypticErrorText).first()).toBeVisible()

      // black pixel means the scene has been cleared.
      await expect
        .poll(() => u.getGreatestPixDiff(pointOnModel, [30, 30, 30]), {
          timeout: 10_000,
        })
        .toBeLessThan(15)
    })
  }
)

test(
  'when code with error first loads you get errors in console',
  { tag: '@electron' },
  async ({ context, page, editor }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      await fsp.mkdir(path.join(dir, 'broken-code'), { recursive: true })
      await fsp.copyFile(
        executorInputPath('broken-code-test.kcl'),
        path.join(dir, 'broken-code', 'main.kcl')
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await expect(page.getByText('broken-code')).toBeVisible()
    await page.getByText('broken-code').click()

    // Gotcha: You can not use scene.waitForExecutionDone() since the KCL code is going to fail
    await expect(page.getByTestId('loading')).toBeAttached()
    await expect(page.getByTestId('loading')).not.toBeAttached({
      timeout: 20_000,
    })

    // Gotcha: Scroll to the text content in code mirror because CodeMirror lazy loads DOM content
    await editor.scrollToText(
      "|> line(end = [0, wallMountL], tag = 'outerEdge')"
    )
    // error in guter
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    const crypticErrorText = `Expected a tag declarator`
    await expect(page.getByText(crypticErrorText).first()).toBeVisible()
  }
)

test.describe('Can export from electron app', () => {
  const exportMethods = ['sidebarButton', 'commandBar'] as const

  for (const method of exportMethods) {
    test(
      `Can export using ${method}`,
      { tag: ['@electron', '@skipLocalEngine'] },
      async ({ context, page, tronApp }, testInfo) => {
        if (!tronApp) { fail() }

        await context.folderSetupFn(async (dir) => {
          const bracketDir = path.join(dir, 'bracket')
          await fsp.mkdir(bracketDir, { recursive: true })
          await fsp.copyFile(
            executorInputPath('focusrite_scarlett_mounting_braket.kcl'),
            path.join(bracketDir, 'main.kcl')
          )
        })

        await page.setBodyDimensions({ width: 1200, height: 500 })
        const u = await getUtils(page)

        page.on('console', console.log)

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
            .poll(() => u.getGreatestPixDiff(pointOnModel, [85, 85, 85]), {
              timeout: 10_000,
            })
            .toBeLessThan(15)
        })

        const exportLocations: Array<Paths> = []
        await test.step(`export the model as a glTF using ${method}`, async () => {
          exportLocations.push(
            await doExport(
              {
                type: 'gltf',
                storage: 'embedded',
                presentation: 'pretty',
              },
              tronApp.projectDirName,
              page,
              method
            )
          )
        })

        const filepath = path.resolve(
          getPlaywrightDownloadDir(tronApp.projectDirName),
          'main.gltf'
        )

        await test.step('Check the export size', async () => {
          await expect
            .poll(
              async () => {
                try {
                  const outputGltf = await fsp.readFile(filepath)
                  return outputGltf.byteLength
                } catch (e) {
                  return 0
                }
              },
              { timeout: 15_000 }
            )
            .toBeGreaterThan(300_000)

          // clean up exported file
          await fsp.rm(filepath)
        })
      }
    )
  }
})
test(
  'Rename and delete projects, also spam arrow keys when renaming',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      await fsp.mkdir(`${dir}/router-template-slate`, { recursive: true })
      await fsp.copyFile(
        'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
        `${dir}/router-template-slate/main.kcl`
      )
      const _1975 = new Date('1975-01-01T00:01:11')
      fs.utimesSync(`${dir}/router-template-slate/main.kcl`, _1975, _1975)

      await fsp.mkdir(`${dir}/bracket`, { recursive: true })
      await fsp.copyFile(
        'rust/kcl-lib/e2e/executor/inputs/focusrite_scarlett_mounting_braket.kcl',
        `${dir}/bracket/main.kcl`
      )
      const _1985 = new Date('1985-01-01T00:02:22')
      fs.utimesSync(`${dir}/bracket/main.kcl`, _1985, _1985)

      await new Promise((r) => setTimeout(r, 1_000))
      await fsp.mkdir(`${dir}/lego`, { recursive: true })
      await fsp.copyFile(
        'rust/kcl-lib/e2e/executor/inputs/lego.kcl',
        `${dir}/lego/main.kcl`
      )
      const _1995 = new Date('1995-01-01T00:03:33')
      fs.utimesSync(`${dir}/lego/main.kcl`, _1995, _1995)
    })

    await page.setBodyDimensions({ width: 1200, height: 600 })

    page.on('console', console.log)

    await page.waitForTimeout(1_000)

    await test.step('rename a project clicking buttons checking left and right arrow does not impact the text', async () => {
      const routerTemplate = page.getByText('router-template-slate')

      await routerTemplate.hover()
      await routerTemplate.focus()

      await expect(page.getByLabel('sketch').last()).toBeVisible()
      await page.getByLabel('sketch').last().click()

      const selectedText = await page.evaluate(() => {
        const selection = window.getSelection()
        return selection ? selection.toString() : ''
      })

      expect(selectedText).toBe('router-template-slate')

      await page.waitForTimeout(100)

      await page.keyboard.press('Backspace')
      await page.keyboard.type('updated project name')

      // spam arrow keys to make sure it doesn't impact the text
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('ArrowRight')
      }
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('ArrowLeft')
      }

      await page.getByLabel('checkmark').last().click()

      await expect(page.getByText('Successfully renamed')).toBeVisible()
      await expect(page.getByText('Successfully renamed')).not.toBeVisible()
      await expect(page.getByText('updated project name')).toBeVisible()
    })

    await test.step('update a project by hitting enter', async () => {
      const project = page.getByText('updated project name')

      await project.hover()
      await project.focus()

      await expect(page.getByLabel('sketch').last()).toBeVisible()
      await page.getByLabel('sketch').last().click()

      const selectedText = await page.evaluate(() => {
        const selection = window.getSelection()
        return selection ? selection.toString() : ''
      })

      expect(selectedText).toBe('updated project name')

      // type "updated project name"
      await page.keyboard.press('Backspace')
      await page.keyboard.type('updated name again')

      await page.keyboard.press('Enter')

      await expect(page.getByText('Successfully renamed')).toBeVisible()
      await expect(page.getByText('Successfully renamed')).not.toBeVisible()

      await expect(page.getByText('updated name again')).toBeVisible()
    })

    await test.step('Cancel and edit by clicking the x button', async () => {
      const project = page.getByText('updated name again')

      await project.hover()
      await project.focus()

      await expect(page.getByLabel('sketch').last()).toBeVisible()
      await page.getByLabel('sketch').last().click()

      const selectedText = await page.evaluate(() => {
        const selection = window.getSelection()
        return selection ? selection.toString() : ''
      })

      expect(selectedText).toBe('updated name again')

      await page.keyboard.press('Backspace')
      await page.keyboard.type('dismiss this text')

      await page.getByLabel('close').last().click()

      await expect(page.getByText('updated name again')).toBeVisible()
    })

    await test.step('Cancel and edit by pressing esc', async () => {
      const project = page.getByText('updated name again')

      await project.hover()
      await project.focus()

      await expect(page.getByLabel('sketch').last()).toBeVisible()
      await page.getByLabel('sketch').last().click()

      const selectedText = await page.evaluate(() => {
        const selection = window.getSelection()
        return selection ? selection.toString() : ''
      })

      expect(selectedText).toBe('updated name again')

      await page.keyboard.press('Backspace')
      await page.keyboard.type('dismiss this text')

      await page.keyboard.press('Escape')

      await expect(page.getByText('updated name again')).toBeVisible()
    })

    await test.step('delete a project by clicking the trash button', async () => {
      const project = page.getByText('updated name again')

      await project.hover()
      await project.focus()

      await expect(page.getByLabel('trash').last()).toBeVisible()
      await page.getByLabel('trash').last().click()

      await expect(page.getByText('This will permanently delete')).toBeVisible()

      await page.getByTestId('delete-confirmation').click()

      await expect(page.getByText('Successfully deleted')).toBeVisible()
      await expect(page.getByText('Successfully deleted')).not.toBeVisible()

      await expect(page.getByText('updated name again')).not.toBeVisible()
    })

    await test.step('rename a project to an empty string should make the field complain', async () => {
      const routerTemplate = page.getByText('bracket')

      await routerTemplate.hover()
      await routerTemplate.focus()

      await expect(page.getByLabel('sketch').last()).toBeVisible()
      await page.getByLabel('sketch').last().click()

      const selectedText = await page.evaluate(() => {
        const selection = window.getSelection()
        return selection ? selection.toString() : ''
      })

      expect(selectedText).toBe('bracket')

      // type "updated project name"
      await page.keyboard.press('Backspace')

      await page.keyboard.press('Enter')
      await page.waitForTimeout(100)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(100)
      await page.keyboard.press('Escape')

      // expect the name not to have changed
      await expect(page.getByText('bracket')).toBeVisible()
    })

    await test.step(`rename a project to a duplicate name should error toast`, async () => {
      const routerTemplate = page.getByText('bracket')

      await routerTemplate.hover()
      await routerTemplate.focus()

      await expect(page.getByLabel('sketch').last()).toBeVisible()
      await page.getByLabel('sketch').last().click()

      const inputField = page.getByTestId('project-rename-input')
      await expect(inputField).toBeVisible()
      await expect(inputField).toBeFocused()
      await inputField.fill('lego')
      await page.keyboard.press('Enter')
      await expect(page.getByText('already exists')).toBeVisible()
    })
  }
)

test(
  'pressing "delete" on home screen should do nothing',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      await fsp.mkdir(`${dir}/router-template-slate`, { recursive: true })
      await fsp.copyFile(
        'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
        `${dir}/router-template-slate/main.kcl`
      )
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    await expect(page.getByText('router-template-slate')).toBeVisible()
    await expect(page.getByText('Loading your Projects...')).not.toBeVisible()
    await expect(page.getByText('Your Projects')).toBeVisible()

    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)
    await page.keyboard.press('Delete')

    // expect to still be on the home page
    await expect(page.getByText('router-template-slate')).toBeVisible()
    await expect(page.getByText('Your Projects')).toBeVisible()
  }
)

test.describe(`Project management commands`, () => {
  test(
    `Rename from project page`,
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const projectName = `my_project_to_rename`
      await context.folderSetupFn(async (dir) => {
        await fsp.mkdir(`${dir}/${projectName}`, { recursive: true })
        await fsp.copyFile(
          'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
          `${dir}/${projectName}/main.kcl`
        )
      })
      const u = await getUtils(page)

      // Constants and locators
      const projectHomeLink = page.getByTestId('project-link')
      const commandButton = page.getByRole('button', { name: 'Commands' })
      const commandOption = page.getByRole('option', { name: 'rename project' })
      const projectNameOption = page.getByRole('option', { name: projectName })
      const projectRenamedName = `project-000`
      // const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const commandContinueButton = page.getByRole('button', {
        name: 'Continue',
      })
      const commandSubmitButton = page.getByRole('button', {
        name: 'Submit command',
      })
      const toastMessage = page.getByText(`Successfully renamed`)

      await test.step(`Setup`, async () => {
        await page.setBodyDimensions({ width: 1200, height: 500 })
        page.on('console', console.log)

        await projectHomeLink.click()
        await u.waitForPageLoad()
      })

      await test.step(`Run rename command via command palette`, async () => {
        await commandButton.click()
        await commandOption.click()
        await projectNameOption.click()

        await expect(commandContinueButton).toBeVisible()
        await commandContinueButton.click()

        await expect(commandSubmitButton).toBeVisible()
        await commandSubmitButton.click()

        await expect(toastMessage).toBeVisible()
      })

      // TODO: in future I'd like the behavior to be to
      // navigate to the new project's page directly,
      // see ProjectContextProvider.tsx:158
      await test.step(`Check the project was renamed and we navigated home`, async () => {
        await expect(projectHomeLink.first()).toBeVisible()
        await expect(projectHomeLink.first()).toContainText(projectRenamedName)
      })
    }
  )

  test(
    `Delete from project page`,
    { tag: '@electron' },
    async ({ context, page, scene, cmdBar }, testInfo) => {
      const projectName = `my_project_to_delete`
      await context.folderSetupFn(async (dir) => {
        await fsp.mkdir(`${dir}/${projectName}`, { recursive: true })
        await fsp.copyFile(
          'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
          `${dir}/${projectName}/main.kcl`
        )
      })
      const u = await getUtils(page)

      // Constants and locators
      const projectHomeLink = page.getByTestId('project-link')
      const commandButton = page.getByRole('button', { name: 'Commands' })
      const commandOption = page.getByRole('option', { name: 'delete project' })
      const projectNameOption = page.getByRole('option', { name: projectName })
      const commandWarning = page.getByText('Are you sure you want to delete?')
      const commandSubmitButton = page.getByRole('button', {
        name: 'Submit command',
      })
      const toastMessage = page.getByText(`Successfully deleted`)
      const noProjectsMessage = page.getByText('No Projects found')

      await test.step(`Setup`, async () => {
        await page.setBodyDimensions({ width: 1200, height: 500 })
        page.on('console', console.log)

        await projectHomeLink.click()
        await u.waitForPageLoad()
        await scene.connectionEstablished()
        await scene.settled(cmdBar)
      })

      await test.step(`Run delete command via command palette`, async () => {
        await commandButton.click()
        await commandOption.click()
        await projectNameOption.click()

        await expect(commandWarning).toBeVisible()
        await expect(commandSubmitButton).toBeVisible()
        await commandSubmitButton.click()

        await expect(toastMessage).toBeVisible()
      })

      await test.step(`Check the project was deleted and we navigated home`, async () => {
        await expect(noProjectsMessage).toBeVisible()
      })
    }
  )
  test(
    `Rename from home page`,
    { tag: '@electron' },
    async ({ context, page, homePage }, testInfo) => {
      const projectName = `my_project_to_rename`
      await context.folderSetupFn(async (dir) => {
        await fsp.mkdir(`${dir}/${projectName}`, { recursive: true })
        await fsp.copyFile(
          'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
          `${dir}/${projectName}/main.kcl`
        )
      })

      // Constants and locators
      const projectHomeLink = page.getByTestId('project-link')
      const commandButton = page.getByRole('button', { name: 'Commands' })
      const commandOption = page.getByRole('option', { name: 'rename project' })
      const projectNameOption = page.getByRole('option', { name: projectName })
      const projectRenamedName = `project-000`
      const commandContinueButton = page.getByRole('button', {
        name: 'Continue',
      })
      const commandSubmitButton = page.getByRole('button', {
        name: 'Submit command',
      })
      const toastMessage = page.getByText(`Successfully renamed`)

      await test.step(`Setup`, async () => {
        await page.setBodyDimensions({ width: 1200, height: 500 })
        page.on('console', console.log)
        await homePage.projectsLoaded()
        await expect(projectHomeLink).toBeVisible()
      })

      await test.step(`Run rename command via command palette`, async () => {
        await commandButton.click()
        await commandOption.click()
        await projectNameOption.click()

        await expect(commandContinueButton).toBeVisible()
        await commandContinueButton.click()

        await expect(commandSubmitButton).toBeVisible()
        await commandSubmitButton.click()

        await expect(toastMessage).toBeVisible()
      })

      await test.step(`Check the project was renamed`, async () => {
        await expect(
          page.getByRole('link', { name: projectRenamedName })
        ).toBeVisible()
        await expect(projectHomeLink).not.toHaveText(projectName)
      })
    }
  )
  test(
    `Delete from home page`,
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const projectName = `my_project_to_delete`
      await context.folderSetupFn(async (dir) => {
        await fsp.mkdir(`${dir}/${projectName}`, { recursive: true })
        await fsp.copyFile(
          'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
          `${dir}/${projectName}/main.kcl`
        )
      })

      // Constants and locators
      const projectHomeLink = page.getByTestId('project-link')
      const commandButton = page.getByRole('button', { name: 'Commands' })
      const commandOption = page.getByRole('option', { name: 'delete project' })
      const projectNameOption = page.getByRole('option', { name: projectName })
      const commandWarning = page.getByText('Are you sure you want to delete?')
      const commandSubmitButton = page.getByRole('button', {
        name: 'Submit command',
      })
      const toastMessage = page.getByText(`Successfully deleted`)
      const noProjectsMessage = page.getByText('No Projects found')

      await test.step(`Setup`, async () => {
        await page.setBodyDimensions({ width: 1200, height: 500 })
        page.on('console', console.log)
        await expect(projectHomeLink).toBeVisible()
      })

      await test.step(`Run delete command via command palette`, async () => {
        await commandButton.click()
        await commandOption.click()
        await projectNameOption.click()

        await expect(commandWarning).toBeVisible()
        await expect(commandSubmitButton).toBeVisible()
        await commandSubmitButton.click()

        await expect(toastMessage).toBeVisible()
      })

      await test.step(`Check the project was deleted`, async () => {
        await expect(projectHomeLink).not.toBeVisible()
        await expect(noProjectsMessage).toBeVisible()
      })
    }
  )
  test(`Create a new project with a colliding name`, async ({
    context,
    homePage,
    toolbar,
    cmdBar,
  }) => {
    const projectName = 'test-project'
    await test.step(`Setup`, async () => {
      await context.folderSetupFn(async (dir) => {
        const projectDir = path.join(dir, projectName)
        await Promise.all([fsp.mkdir(projectDir, { recursive: true })])
        await Promise.all([
          fsp.copyFile(
            executorInputPath('router-template-slate.kcl'),
            path.join(projectDir, 'main.kcl')
          ),
        ])
      })
      await homePage.expectState({
        projectCards: [
          {
            title: projectName,
            fileCount: 1,
          },
        ],
        sortBy: 'last-modified-desc',
      })
    })

    await test.step('Create a new project with the same name', async () => {
      await cmdBar.openCmdBar()
      await cmdBar.chooseCommand('create project')
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Create project',
        currentArgKey: 'name',
        currentArgValue: '',
        headerArguments: {
          Name: '',
        },
        highlightedHeaderArg: 'name',
      })
      await cmdBar.argumentInput.fill(projectName)
      await cmdBar.progressCmdBar()
    })

    await test.step(`Check the project was created with a non-colliding name`, async () => {
      await toolbar.logoLink.click()
      await homePage.expectState({
        projectCards: [
          {
            title: projectName + '-1',
            fileCount: 1,
          },
          {
            title: projectName,
            fileCount: 1,
          },
        ],
        sortBy: 'last-modified-desc',
      })
    })

    await test.step('Create another project with the same name', async () => {
      await cmdBar.openCmdBar()
      await cmdBar.chooseCommand('create project')
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Create project',
        currentArgKey: 'name',
        currentArgValue: '',
        headerArguments: {
          Name: '',
        },
        highlightedHeaderArg: 'name',
      })
      await cmdBar.argumentInput.fill(projectName)
      await cmdBar.progressCmdBar()
    })

    await test.step(`Check the second project was created with a non-colliding name`, async () => {
      await toolbar.logoLink.click()
      await homePage.expectState({
        projectCards: [
          {
            title: projectName + '-2',
            fileCount: 1,
          },
          {
            title: projectName + '-1',
            fileCount: 1,
          },
          {
            title: projectName,
            fileCount: 1,
          },
        ],
        sortBy: 'last-modified-desc',
      })
    })
  })
})

test(`Create a few projects using the default project name`, async ({
  homePage,
  toolbar,
}) => {
  for (let i = 0; i < 12; i++) {
    await test.step(`Create project ${i}`, async () => {
      await homePage.expectState({
        projectCards: Array.from({ length: i }, (_, i) => ({
          title: `project-${i.toString().padStart(3, '0')}`,
          fileCount: 1,
        })).toReversed(),
        sortBy: 'last-modified-desc',
      })
      await homePage.createAndGoToProject()
      await toolbar.logoLink.click()
    })
  }
})

test(
  'File in the file pane should open with a single click',
  { tag: '@electron' },
  async ({ context, homePage, page }, testInfo) => {
    const projectName = 'router-template-slate'
    await context.folderSetupFn(async (dir) => {
      await fsp.mkdir(`${dir}/${projectName}`, { recursive: true })
      await fsp.copyFile(
        'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
        `${dir}/${projectName}/main.kcl`
      )
      await fsp.copyFile(
        'rust/kcl-lib/e2e/executor/inputs/focusrite_scarlett_mounting_braket.kcl',
        `${dir}/${projectName}/otherThingToClickOn.kcl`
      )
    })

    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    await page.getByText(projectName).click()
    await u.waitForPageLoad()

    await expect(u.codeLocator).toContainText('routerDiameter')
    await expect(u.codeLocator).toContainText('templateGap')
    await expect(u.codeLocator).toContainText('minClampingDistance')

    await page.getByRole('button', { name: 'Project Files' }).click()

    const file = page.getByRole('button', { name: 'otherThingToClickOn.kcl' })
    await expect(file).toBeVisible()

    await file.click()

    await expect(u.codeLocator).toContainText(
      'A mounting bracket for the Focusrite Scarlett Solo audio interface'
    )
  }
)

test(
  'Nested directories in project without main.kcl do not create main.kcl',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    let testDir: string | undefined
    await context.folderSetupFn(async (dir) => {
      await fsp.mkdir(path.join(dir, 'router-template-slate', 'nested'), {
        recursive: true,
      })
      await fsp.copyFile(
        executorInputPath('router-template-slate.kcl'),
        path.join(dir, 'router-template-slate', 'nested', 'slate.kcl')
      )
      await fsp.copyFile(
        executorInputPath('focusrite_scarlett_mounting_braket.kcl'),
        path.join(dir, 'router-template-slate', 'nested', 'bracket.kcl')
      )
      testDir = dir
    })
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    await test.step('Open the project', async () => {
      await page.getByText('router-template-slate').click()
      await expect(page.getByTestId('loading')).toBeAttached()
      await expect(page.getByTestId('loading')).not.toBeAttached({
        timeout: 20_000,
      })

      // It actually loads.
      await expect(u.codeLocator).toContainText('mounting bracket')
      await expect(u.codeLocator).toContainText('radius =')
    })

    await u.openFilePanel()

    // Find the current file.
    const filesPane = page.locator('#files-pane')
    await expect(filesPane.getByText('bracket.kcl')).toBeVisible()
    // But there's no main.kcl in the file tree browser.
    await expect(filesPane.getByText('main.kcl')).not.toBeVisible()
    // No main.kcl file is created on the filesystem.
    expect(testDir).toBeDefined()
    if (testDir !== undefined) {
      // eslint-disable-next-line jest/no-conditional-expect
      await expect(
        fsp.access(path.join(testDir, 'router-template-slate', 'main.kcl'))
      ).rejects.toThrow()
      // eslint-disable-next-line jest/no-conditional-expect
      await expect(
        fsp.access(
          path.join(testDir, 'router-template-slate', 'nested', 'main.kcl')
        )
      ).rejects.toThrow()
    }
  }
)

test.fixme(
  'Deleting projects, can delete individual project, can still create projects after deleting all',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    const projectData = [
      ['router-template-slate', 'cylinder.kcl'],
      ['bracket', 'focusrite_scarlett_mounting_braket.kcl'],
      ['lego', 'lego.kcl'],
    ]

    await context.folderSetupFn(async (dir) => {
      // Do these serially to ensure the order is correct
      for (const [name, file] of projectData) {
        await fsp.mkdir(path.join(dir, name), { recursive: true })
        await fsp.copyFile(
          executorInputPath(file),
          path.join(dir, name, `main.kcl`)
        )
        // Wait 1s between each project to ensure the order is correct
        await new Promise((r) => setTimeout(r, 1_000))
      }
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })
    page.on('console', console.log)

    await test.step('delete the middle project, i.e. the bracket project', async () => {
      const project = page.getByTestId('project-link').getByText('bracket')

      await project.hover()
      await project.focus()

      await page
        .locator('[data-edit-buttons-for="bracket"]')
        .getByLabel('trash')
        .click()

      await expect(page.getByText('This will permanently delete')).toBeVisible()

      await page.getByTestId('delete-confirmation').click()

      await expect(page.getByText('Successfully deleted')).toBeVisible()
      await expect(page.getByText('Successfully deleted')).not.toBeVisible()

      await expect(page.getByText('bracket')).not.toBeVisible()
    })

    await test.step('Now that the middle project is deleted, check the other projects are still there', async () => {
      await expect(page.getByText('router-template-slate')).toBeVisible()
      await expect(page.getByText('lego')).toBeVisible()
    })

    await test.step('delete other two projects', async () => {
      await page
        .locator('[data-edit-buttons-for="router-template-slate"]')
        .getByLabel('trash')
        .click()
      await page.getByTestId('delete-confirmation').click()

      await page
        .locator('[data-edit-buttons-for="lego"]')
        .getByLabel('trash')
        .click()
      await page.getByTestId('delete-confirmation').click()
    })

    await test.step('Check that the home page is empty', async () => {
      await expect(page.getByText('No Projects found')).toBeVisible()
    })

    await test.step('Check we can still create a project', async () => {
      await createProject({ name: 'project-000', page, returnHome: true })
      await expect(
        page.getByTestId('project-link').filter({ hasText: 'project-000' })
      ).toBeVisible()
    })
  }
)

test(
  'Can load a file with CRLF line endings',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      const routerTemplateDir = path.join(dir, 'router-template-slate')
      await fsp.mkdir(routerTemplateDir, { recursive: true })

      const file = await fsp.readFile(
        executorInputPath('router-template-slate.kcl'),
        'utf-8'
      )
      // Replace both \r optionally so we don't end up with \r\r\n
      const fileWithCRLF = file.replace(/\r?\n/g, '\r\n')
      await fsp.writeFile(
        path.join(routerTemplateDir, 'main.kcl'),
        fileWithCRLF,
        'utf-8'
      )
    })
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    await page.getByText('router-template-slate').click()
    await expect(page.getByTestId('loading')).toBeAttached()
    await expect(page.getByTestId('loading')).not.toBeAttached({
      timeout: 20_000,
    })

    await expect(u.codeLocator).toContainText('routerDiameter')
    await expect(u.codeLocator).toContainText('templateGap')
    await expect(u.codeLocator).toContainText('minClampingDistance')
  }
)

test(
  'Can sort projects on home page',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    const projectData = [
      ['router-template-slate', 'cylinder.kcl'],
      ['bracket', 'focusrite_scarlett_mounting_braket.kcl'],
      ['lego', 'lego.kcl'],
    ]

    await context.folderSetupFn(async (dir) => {
      // Do these serially to ensure the order is correct
      for (const [name, file] of projectData) {
        await fsp.mkdir(path.join(dir, name), { recursive: true })
        await fsp.copyFile(
          executorInputPath(file),
          path.join(dir, name, `main.kcl`)
        )
        // Wait 1s between each project to ensure the order is correct
        await new Promise((r) => setTimeout(r, 1_000))
      }
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })

    const getAllProjects = () => page.getByTestId('project-link').all()

    page.on('console', console.log)

    await test.step('should be shorted by modified initially', async () => {
      const lastModifiedButton = page.getByRole('button', {
        name: 'Last Modified',
      })
      await expect(lastModifiedButton).toBeVisible()
      await expect(lastModifiedButton.getByLabel('arrow down')).toBeVisible()
    })

    const projectNamesOrderedByModified = [
      'lego',
      'bracket',
      'router-template-slate',
    ]
    await test.step('Check the order of the projects is correct', async () => {
      for (const [index, projectLink] of (await getAllProjects()).entries()) {
        await expect(projectLink).toContainText(
          projectNamesOrderedByModified[index]
        )
      }
    })

    await test.step('Reverse modified order', async () => {
      const lastModifiedButton = page.getByRole('button', {
        name: 'Last Modified',
      })
      await lastModifiedButton.click()
      await expect(lastModifiedButton).toBeVisible()
      await expect(lastModifiedButton.getByLabel('arrow up')).toBeVisible()
    })

    await test.step('Check the order of the projects is has reversed', async () => {
      for (const [index, projectLink] of (await getAllProjects()).entries()) {
        await expect(projectLink).toContainText(
          [...projectNamesOrderedByModified].reverse()[index]
        )
      }
    })

    await test.step('Change order to by name', async () => {
      const nameButton = page.getByRole('button', {
        name: 'Name',
      })
      await nameButton.click()
      await expect(nameButton).toBeVisible()
      await expect(nameButton.getByLabel('arrow down')).toBeVisible()
    })

    const projectNamesOrderedByName = [
      'bracket',
      'lego',
      'router-template-slate',
    ]
    await test.step('Check the order of the projects is by name', async () => {
      for (const [index, projectLink] of (await getAllProjects()).entries()) {
        await expect(projectLink).toContainText(
          projectNamesOrderedByName[index]
        )
      }
    })

    await test.step('Reverse name order', async () => {
      const nameButton = page.getByRole('button', {
        name: 'Name',
      })
      await nameButton.click()
      await expect(nameButton).toBeVisible()
      await expect(nameButton.getByLabel('arrow up')).toBeVisible()
    })

    await test.step('Check the order of the projects is by name reversed', async () => {
      for (const [index, projectLink] of (await getAllProjects()).entries()) {
        await expect(projectLink).toContainText(
          [...projectNamesOrderedByName].reverse()[index]
        )
      }
    })
  }
)

test.fixme(
  'When the project folder is empty, user can create new project and open it.',
  { tag: '@electron' },
  async ({ page }, testInfo) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    // Locators and constants
    const gizmo = page.locator('[aria-label*=gizmo]')
    const resetCameraButton = page.getByRole('button', { name: 'Reset view' })
    const pointOnModel = { x: 660, y: 250 }
    const expectedStartCamZPosition = 15633.47

    // Constants and locators
    const projectLinks = page.getByTestId('project-link')

    // expect to see text "No Projects found"
    await expect(page.getByText('No Projects found')).toBeVisible()

    await createProject({ name: 'project-000', page, returnHome: true })
    await expect(projectLinks.getByText('project-000')).toBeVisible()

    await projectLinks.getByText('project-000').click()

    await u.waitForPageLoad()

    await page.locator('.cm-content').fill(`sketch001 = startSketchOn('XZ')
  |> startProfileAt([-87.4, 282.92], %)
  |> line(end = [324.07, 27.199], tag = $seg01)
  |> line(end = [118.328, -291.754])
  |> line(end = [-180.04, -202.08])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 200)`)
    await page.waitForTimeout(800)

    async function getCameraZValue() {
      return page
        .getByTestId('cam-z-position')
        .inputValue()
        .then((value) => parseFloat(value))
    }

    await test.step(`Reset camera`, async () => {
      await u.openDebugPanel()
      await u.clearCommandLogs()
      await u.doAndWaitForCmd(async () => {
        await gizmo.click({ button: 'right' })
        await resetCameraButton.click()
      }, 'zoom_to_fit')
      await expect
        .poll(getCameraZValue, {
          message: 'Camera Z should be at expected position after reset',
        })
        .toEqual(expectedStartCamZPosition)
    })

    // gray at this pixel means the stream has loaded in the most
    // user way we can verify it (pixel color)
    await expect
      .poll(() => u.getGreatestPixDiff(pointOnModel, [143, 143, 143]), {
        timeout: 10_000,
      })
      .toBeLessThan(30)

    await expect(async () => {
      await page.mouse.move(0, 0, { steps: 5 })
      await page.mouse.move(pointOnModel.x, pointOnModel.y, { steps: 5 })
      await page.mouse.click(pointOnModel.x, pointOnModel.y)
      // check user can interact with model by checking it turns yellow
      await expect
        .poll(() => u.getGreatestPixDiff(pointOnModel, [180, 180, 137]))
        .toBeLessThan(15)
    }).toPass({ timeout: 40_000, intervals: [1_000] })

    await page.getByTestId('app-logo').click()

    await expect(
      page.getByRole('button', { name: 'Create project' })
    ).toBeVisible()

    for (let i = 1; i <= 10; i++) {
      const name = `project-${i.toString().padStart(3, '0')}`
      await createProject({ name, page, returnHome: true })
      await expect(projectLinks.getByText(name)).toBeVisible()
    }
  }
)

test(
  'Opening a project should successfully load the stream, (regression test that this also works when switching between projects)',
  { tag: '@electron' },
  async ({ context, page, cmdBar, homePage }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      await fsp.mkdir(path.join(dir, 'router-template-slate'), {
        recursive: true,
      })
      await fsp.copyFile(
        path.join(
          'rust',
          'kcl-lib',
          'e2e',
          'executor',
          'inputs',
          'router-template-slate.kcl'
        ),
        path.join(dir, 'router-template-slate', 'main.kcl')
      )
      await fsp.mkdir(path.join(dir, 'bracket'), { recursive: true })
      await fsp.copyFile(
        path.join(
          'rust',
          'kcl-lib',
          'e2e',
          'executor',
          'inputs',
          'focusrite_scarlett_mounting_braket.kcl'
        ),
        path.join(dir, 'bracket', 'main.kcl')
      )
    })
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    const pointOnModel = { x: 630, y: 280 }

    await test.step('Opening the bracket project via command palette should load the stream', async () => {
      await homePage.expectState({
        projectCards: [
          {
            title: 'bracket',
            fileCount: 1,
          },
          {
            title: 'router-template-slate',
            fileCount: 1,
          },
        ],
        sortBy: 'last-modified-desc',
      })

      await cmdBar.openCmdBar()
      await cmdBar.chooseCommand('open project')
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Open project',
        currentArgKey: 'name',
        currentArgValue: '',
        headerArguments: {
          Name: '',
        },
        highlightedHeaderArg: 'name',
      })
      await cmdBar.argumentInput.fill('brac')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'commandBarClosed',
      })

      await u.waitForPageLoad()

      // gray at this pixel means the stream has loaded in the most
      // user way we can verify it (pixel color)
      await expect
        .poll(() => u.getGreatestPixDiff(pointOnModel, [85, 85, 85]), {
          timeout: 10_000,
        })
        .toBeLessThan(15)
    })

    await test.step('Clicking the logo takes us back to the projects page / home', async () => {
      await page.getByTestId('app-logo').click()

      await expect(page.getByRole('link', { name: 'bracket' })).toBeVisible()
      await expect(page.getByText('router-template-slate')).toBeVisible()
      await expect(page.getByText('Create project')).toBeVisible()
    })

    await test.step('Opening the router-template project via link should load the stream', async () => {
      // expect to see the text bracket
      await expect(page.getByText('router-template-slate')).toBeVisible()

      await page.getByText('router-template-slate').click()

      await u.waitForPageLoad()

      // gray at this pixel means the stream has loaded in the most
      // user way we can verify it (pixel color)
      await expect
        .poll(() => u.getGreatestPixDiff(pointOnModel, [143, 143, 143]), {
          timeout: 10_000,
        })
        .toBeLessThan(15)
    })

    await test.step('The projects on the home page should still be normal', async () => {
      await page.getByTestId('project-sidebar-toggle').click()
      await expect(
        page.getByRole('button', { name: 'Go to Home' })
      ).toBeVisible()
      await page.getByRole('button', { name: 'Go to Home' }).click()

      await homePage.expectState({
        projectCards: [
          {
            title: 'bracket',
            fileCount: 1,
          },
          {
            title: 'router-template-slate',
            fileCount: 1,
          },
        ],
        sortBy: 'last-modified-desc',
      })
    })
  }
)

test(
  'You can change the root projects directory and nothing is lost',
  { tag: '@electron' },
  async ({ context, page, tronApp, homePage }, testInfo) => {
    if (!tronApp) { fail() }

    await context.folderSetupFn(async (dir) => {
      await Promise.all([
        fsp.mkdir(`${dir}/router-template-slate`, { recursive: true }),
        fsp.mkdir(`${dir}/bracket`, { recursive: true }),
      ])
      await Promise.all([
        fsp.copyFile(
          'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
          `${dir}/router-template-slate/main.kcl`
        ),
        fsp.copyFile(
          'rust/kcl-lib/e2e/executor/inputs/focusrite_scarlett_mounting_braket.kcl',
          `${dir}/bracket/main.kcl`
        ),
      ])
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    // we'll grab this from the settings on screen before we switch
    let originalProjectDirName: string
    const newProjectDirName = testInfo.outputPath(
      'electron-test-projects-dir-2'
    )
    if (fs.existsSync(newProjectDirName)) {
      await fsp.rm(newProjectDirName, { recursive: true })
    }

    await homePage.projectsLoaded()

    await test.step('We can change the root project directory', async () => {
      // expect to see the project directory settings link
      await expect(
        page.getByTestId('project-directory-settings-link')
      ).toBeVisible()

      await page.getByTestId('project-directory-settings-link').click()

      await expect(page.getByTestId('project-directory-button')).toBeVisible()
      originalProjectDirName = await page
        .locator('section#projectDirectory input')
        .inputValue()

      const handleFile = tronApp.electron.evaluate(
        async ({ dialog }, filePaths) => {
          dialog.showOpenDialog = () =>
            Promise.resolve({ canceled: false, filePaths })
        },
        [newProjectDirName]
      )
      await page.getByTestId('project-directory-button').click()
      await handleFile

      await expect
        .poll(() => page.locator('section#projectDirectory input').inputValue())
        .toContain(newProjectDirName)

      await page.getByTestId('settings-close-button').click()

      await homePage.projectsLoaded()

      await expect(page.getByText('No Projects found')).toBeVisible()
      await createProject({ name: 'project-000', page, returnHome: true })
      await expect(
        page.getByTestId('project-link').filter({ hasText: 'project-000' })
      ).toBeVisible()
    })

    await test.step('We can change back to the original root project directory', async () => {
      await expect(
        page.getByTestId('project-directory-settings-link')
      ).toBeVisible()

      await page.getByTestId('project-directory-settings-link').click()

      const handleFile = tronApp.electron.evaluate(
        async ({ dialog }, filePaths) => {
          dialog.showOpenDialog = () =>
            Promise.resolve({ canceled: false, filePaths })
        },
        [originalProjectDirName]
      )
      await expect(page.getByTestId('project-directory-button')).toBeVisible()

      await page.getByTestId('project-directory-button').click()
      await handleFile

      await homePage.projectsLoaded()
      await expect(page.locator('section#projectDirectory input')).toHaveValue(
        originalProjectDirName
      )

      await page.getByTestId('settings-close-button').click()

      await expect(page.getByText('bracket')).toBeVisible()
      await expect(page.getByText('router-template-slate')).toBeVisible()
    })
  }
)

test(
  'Search projects on desktop home',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    const projectData = [
      ['basic bracket', 'focusrite_scarlett_mounting_braket.kcl'],
      ['basic-cube', 'basic_fillet_cube_end.kcl'],
      ['basic-cylinder', 'cylinder.kcl'],
      ['router-template-slate', 'router-template-slate.kcl'],
      ['Ancient Temple Block', 'lego.kcl'],
    ]
    await context.folderSetupFn(async (dir) => {
      // Do these serially to ensure the order is correct
      for (const [name, file] of projectData) {
        await fsp.mkdir(path.join(dir, name), { recursive: true })
        await fsp.copyFile(
          executorInputPath(file),
          path.join(dir, name, `main.kcl`)
        )
      }
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    // Our locator constants
    const searchInput = page.getByPlaceholder('Search projects')
    const projectLinks = page.getByTestId('project-link')

    await test.step('Search for "basi"', async () => {
      await searchInput.fill('basi')
      await expect(projectLinks).toHaveCount(3)

      // Check each of the "basi" projects are visible
      for (const [name] of projectData.slice(0, 3)) {
        await expect(page.getByText(name)).toBeVisible()
      }
    })

    await test.step('Clear search to see all projects', async () => {
      await searchInput.fill('')
      await expect(projectLinks).toHaveCount(projectData.length)
    })

    await test.step('Search for "templ"', async () => {
      await searchInput.fill('templ')
      await expect(projectLinks).toHaveCount(2)

      // Check the "*templ*" project is visible
      for (const [name] of projectData.slice(-2)) {
        await expect(page.getByText(name)).toBeVisible()
      }
    })
  }
)

test(
  'file pane is scrollable when there are many files',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      const testDir = path.join(dir, 'testProject')
      await fsp.mkdir(testDir, { recursive: true })
      const fileNames = [
        'angled_line.kcl',
        'basic_fillet_cube_close_opposite.kcl',
        'basic_fillet_cube_end.kcl',
        'basic_fillet_cube_next_adjacent.kcl',
        'basic_fillet_cube_previous_adjacent.kcl',
        'basic_fillet_cube_start.kcl',
        'big_number_angle_to_match_length_x.kcl',
        'big_number_angle_to_match_length_y.kcl',
        'close_arc.kcl',
        'computed_var.kcl',
        'cube-embedded.gltf',
        'cube.bin',
        'cube.glb',
        'cube.gltf',
        'cube.kcl',
        'cube.mtl',
        'cube.obj',
        'cylinder.kcl',
        'dimensions_match.kcl',
        'extrude-custom-plane.kcl',
        'extrude-inside-fn-with-tags.kcl',
        'fillet-and-shell.kcl',
        'fillet_duplicate_tags.kcl',
        'focusrite_scarlett_mounting_braket.kcl',
        'function_sketch.kcl',
        'function_sketch_with_position.kcl',
        'global-tags.kcl',
        'helix_defaults.kcl',
        'helix_defaults_negative_extrude.kcl',
        'helix_with_length.kcl',
        'i_shape.kcl',
        'kittycad_svg.kcl',
        'lego.kcl',
        'lsystem.kcl',
        'math.kcl',
        'member_expression_sketch.kcl',
        'mike_stress_test.kcl',
        'negative_args.kcl',
        'order-sketch-extrude-in-order.kcl',
        'order-sketch-extrude-out-of-order.kcl',
        'parametric.kcl',
        'parametric_with_tan_arc.kcl',
        'pattern_vase.kcl',
        'pentagon_fillet_sugar.kcl',
        'pipe_as_arg.kcl',
        'pipes_on_pipes.kcl',
        'riddle.kcl',
        'riddle_small.kcl',
        'router-template-slate.kcl',
        'scoped-tags.kcl',
        'server-rack-heavy.kcl',
        'server-rack-lite.kcl',
        'sketch_on_face.kcl',
        'sketch_on_face_circle_tagged.kcl',
        'sketch_on_face_end.kcl',
        'sketch_on_face_end_negative_extrude.kcl',
        'sketch_on_face_start.kcl',
        'tan_arc_x_line.kcl',
        'tangential_arc.kcl',
      ]
      for (const fileName of fileNames) {
        await fsp.copyFile(
          executorInputPath(fileName),
          path.join(testDir, fileName)
        )
      }
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    await test.step('setup, open file pane', async () => {
      await page.getByText('testProject').click()
      await expect(page.getByTestId('loading')).toBeAttached()
      await expect(page.getByTestId('loading')).not.toBeAttached({
        timeout: 20_000,
      })

      await page.getByTestId('files-pane-button').click()
    })

    await test.step('check the last file is out of view initially, and can be scrolled to', async () => {
      const element = page.getByText('tangential_arc.kcl')
      const container = page.getByTestId('file-pane-scroll-container')

      await expect(await isOutOfViewInScrollContainer(element, container)).toBe(
        true
      )
      await element.scrollIntoViewIfNeeded()
      await expect(await isOutOfViewInScrollContainer(element, container)).toBe(
        false
      )
    })
  }
)

test(
  'select all in code editor does not actually select all, just what is visible (regression)',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      // rust/kcl-lib/e2e/executor/inputs/mike_stress_test.kcl
      const name = 'mike_stress_test'
      const testDir = path.join(dir, name)
      await fsp.mkdir(testDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath(`${name}.kcl`),
        path.join(testDir, 'main.kcl')
      )
    })
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    await page.getByText('mike_stress_test').click()

    await test.step('select all in code editor, check its length', async () => {
      await u.codeLocator.click()
      // expect u.codeLocator to have some text
      await expect(u.codeLocator).toContainText('line(')
      await page.keyboard.down('ControlOrMeta')
      await page.keyboard.press('KeyA')
      await page.keyboard.up('ControlOrMeta')

      // check the length of the selected text
      const selectedText = await page.evaluate(() => {
        const selection = window.getSelection()
        return selection ? selection.toString() : ''
      })
      // even though if the user copied the text into their clipboard they would get the full text
      // it seems that the selection is limited to what is visible
      // we just want to check we did select something, and later we've verify it's empty
      expect(selectedText.length).toBeGreaterThan(10)
    })

    await test.step('delete all the text, select again and verify there are no characters left', async () => {
      await page.keyboard.press('Backspace')

      await page.keyboard.down('ControlOrMeta')
      await page.keyboard.press('KeyA')
      await page.keyboard.up('ControlOrMeta')

      // check the length of the selected text
      const selectedText = await page.evaluate(() => {
        const selection = window.getSelection()
        return selection ? selection.toString() : ''
      })
      expect(selectedText.length).toBe(0)
      await expect(u.codeLocator).toHaveText('')
    })
  }
)

test(
  'Settings persist across restarts',
  { tag: '@electron' },
  async ({ page, scene, cmdBar }, testInfo) => {
    await test.step('We can change a user setting like theme', async () => {
      await page.setBodyDimensions({ width: 1200, height: 500 })

      page.on('console', console.log)

      await page.getByTestId('user-sidebar-toggle').click()

      await page.getByTestId('user-settings').click()

      await expect(page.getByTestId('app-theme')).toHaveValue('dark')

      await page.getByTestId('app-theme').selectOption('light')
      await expect(page.getByTestId('app-theme')).toHaveValue('light')

      // Give time to system for writing to a persistent store
      await page.waitForTimeout(1000)
    })

    await test.step('Starting the app again and we can see the same theme', async () => {
      await page.reload()
      await page.setBodyDimensions({ width: 1200, height: 500 })

      page.on('console', console.log)
      await expect(page.getByTestId('app-theme')).toHaveValue('light')
    })
  }
)

// Flaky
test.fixme(
  'Original project name persist after onboarding',
  { tag: '@electron' },
  async ({ page }, testInfo) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })

    const getAllProjects = () => page.getByTestId('project-link').all()
    page.on('console', console.log)

    await test.step('Should create and name a project called wrist brace', async () => {
      await createProject({ name: 'wrist brace', page, returnHome: true })
    })

    await test.step('Should go through onboarding', async () => {
      await page.getByTestId('user-sidebar-toggle').click()
      await page.getByTestId('user-settings').click()
      await page.getByRole('button', { name: 'Replay Onboarding' }).click()

      const numberOfOnboardingSteps = 12
      for (let clicks = 0; clicks < numberOfOnboardingSteps; clicks++) {
        await page.getByTestId('onboarding-next').click()
      }

      await page.getByTestId('project-sidebar-toggle').click()
    })

    await test.step('Should go home after onboarding is completed', async () => {
      await page.getByRole('button', { name: 'Go to Home' }).click()
    })

    await test.step('Should show the original project called wrist brace', async () => {
      const projectNames = ['Tutorial Project 00', 'wrist brace']
      for (const [index, projectLink] of (await getAllProjects()).entries()) {
        await expect(projectLink).toContainText(projectNames[index])
      }
    })
  }
)

test(
  'project name with foreign characters should open',
  { tag: '@electron' },
  async ({ context, page }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'اَلْعَرَبِيَّةُ')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('focusrite_scarlett_mounting_braket.kcl'),
        path.join(bracketDir, 'main.kcl')
      )

      await fsp.writeFile(path.join(bracketDir, 'empty.kcl'), '')
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    const u = await getUtils(page)

    page.on('console', console.log)

    const pointOnModel = { x: 630, y: 280 }

    await test.step('Opening the اَلْعَرَبِيَّةُ project should load the stream', async () => {
      // expect to see the text bracket
      await expect(page.getByText('اَلْعَرَبِيَّةُ')).toBeVisible()

      await page.getByText('اَلْعَرَبِيَّةُ').click()

      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).toBeEnabled({
        timeout: 20_000,
      })

      // gray at this pixel means the stream has loaded in the most
      // user way we can verify it (pixel color)
      await expect
        .poll(() => u.getGreatestPixDiff(pointOnModel, [85, 85, 85]), {
          timeout: 10_000,
        })
        .toBeLessThan(15)
    })
  }
)
