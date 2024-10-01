import { test, expect, Page } from '@playwright/test'
import {
  doExport,
  executorInputPath,
  getUtils,
  isOutOfViewInScrollContainer,
  Paths,
  setupElectron,
  tearDown,
  createProjectAndRenameIt,
} from './test-utils'
import fsp from 'fs/promises'
import fs from 'fs'
import { join } from 'path'

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test(
  'click help/keybindings from home page',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async () => {},
    })

    await page.setViewportSize({ width: 1200, height: 500 })

    page.on('console', console.log)

    // click ? button
    await page.getByTestId('help-button').click()
    await expect(page.getByTestId('keybindings-button')).toBeVisible()
    // Click keyboard shortcuts button.
    await page.getByTestId('keybindings-button').click()
    // Make sure the keyboard shortcuts modal is visible.
    await expect(page.getByText('Enter Sketch Mode')).toBeVisible()

    await electronApp.close()
  }
)

test(
  'click help/keybindings from project page',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        const bracketDir = join(dir, 'bracket')
        await fsp.mkdir(bracketDir, { recursive: true })
        await fsp.copyFile(
          executorInputPath('focusrite_scarlett_mounting_braket.kcl'),
          join(bracketDir, 'main.kcl')
        )
      },
    })

    await page.setViewportSize({ width: 1200, height: 500 })

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

    await electronApp.close()
  }
)

test(
  'when code with error first loads you get errors in console',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        await fsp.mkdir(join(dir, 'broken-code'), { recursive: true })
        await fsp.copyFile(
          executorInputPath('broken-code-test.kcl'),
          join(dir, 'broken-code', 'main.kcl')
        )
      },
    })

    await page.setViewportSize({ width: 1200, height: 500 })

    await expect(page.getByText('broken-code')).toBeVisible()

    await page.getByText('broken-code').click()

    await expect(page.getByTestId('loading')).toBeAttached()
    await expect(page.getByTestId('loading')).not.toBeAttached({
      timeout: 20_000,
    })

    // error in guter
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    const crypticErrorText = `Expected a tag declarator`
    await expect(page.getByText(crypticErrorText).first()).toBeVisible()

    await electronApp.close()
  }
)

test.describe('Can export from electron app', () => {
  const exportMethods = ['sidebarButton', 'commandBar'] as const

  for (const method of exportMethods) {
    test(
      `Can export using ${method}`,
      { tag: '@electron' },
      async ({ browserName }, testInfo) => {
        const { electronApp, page } = await setupElectron({
          testInfo,
          folderSetupFn: async (dir) => {
            const bracketDir = join(dir, 'bracket')
            await fsp.mkdir(bracketDir, { recursive: true })
            await fsp.copyFile(
              executorInputPath('focusrite_scarlett_mounting_braket.kcl'),
              join(bracketDir, 'main.kcl')
            )
          },
        })

        await page.setViewportSize({ width: 1200, height: 500 })
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
              page,
              method
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
            .toBe(431341)

          // clean up output.gltf
          await fsp.rm('output.gltf')
        })

        await electronApp.close()
      }
    )
  }
})
test(
  'Rename and delete projects, also spam arrow keys when renaming',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        await fsp.mkdir(`${dir}/router-template-slate`, { recursive: true })
        await fsp.copyFile(
          'src/wasm-lib/tests/executor/inputs/router-template-slate.kcl',
          `${dir}/router-template-slate/main.kcl`
        )
        const _1975 = new Date('1975-01-01T00:01:11')
        fs.utimesSync(`${dir}/router-template-slate/main.kcl`, _1975, _1975)

        await fsp.mkdir(`${dir}/bracket`, { recursive: true })
        await fsp.copyFile(
          'src/wasm-lib/tests/executor/inputs/focusrite_scarlett_mounting_braket.kcl',
          `${dir}/bracket/main.kcl`
        )
        const _1985 = new Date('1985-01-01T00:02:22')
        fs.utimesSync(`${dir}/bracket/main.kcl`, _1985, _1985)

        await new Promise((r) => setTimeout(r, 1_000))
        await fsp.mkdir(`${dir}/lego`, { recursive: true })
        await fsp.copyFile(
          'src/wasm-lib/tests/executor/inputs/lego.kcl',
          `${dir}/lego/main.kcl`
        )
        const _1995 = new Date('1995-01-01T00:03:33')
        fs.utimesSync(`${dir}/lego/main.kcl`, _1995, _1995)
      },
    })

    await page.setViewportSize({ width: 1200, height: 500 })

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

    await electronApp.close()
  }
)

test(
  'pressing "delete" on home screen should do nothing',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        await fsp.mkdir(`${dir}/router-template-slate`, { recursive: true })
        await fsp.copyFile(
          'src/wasm-lib/tests/executor/inputs/router-template-slate.kcl',
          `${dir}/router-template-slate/main.kcl`
        )
      },
    })
    await page.setViewportSize({ width: 1200, height: 500 })

    page.on('console', console.log)

    await expect(page.getByText('router-template-slate')).toBeVisible()
    await expect(page.getByText('Your Projects')).toBeVisible()

    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)
    await page.keyboard.press('Delete')

    // expect to still be on the home page
    await expect(page.getByText('router-template-slate')).toBeVisible()
    await expect(page.getByText('Your Projects')).toBeVisible()

    await electronApp.close()
  }
)

test(
  'File in the file pane should open with a single click',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        await fsp.mkdir(`${dir}/router-template-slate`, { recursive: true })
        await fsp.copyFile(
          'src/wasm-lib/tests/executor/inputs/router-template-slate.kcl',
          `${dir}/router-template-slate/main.kcl`
        )
        await fsp.copyFile(
          'src/wasm-lib/tests/executor/inputs/focusrite_scarlett_mounting_braket.kcl',
          `${dir}/router-template-slate/otherThingToClickOn.kcl`
        )
      },
    })
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    page.on('console', console.log)

    await page.getByText('router-template-slate').click()
    await expect(page.getByTestId('loading')).toBeAttached()
    await expect(page.getByTestId('loading')).not.toBeAttached({
      timeout: 20_000,
    })

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

    await electronApp.close()
  }
)

test(
  'Nested directories in project without main.kcl do not create main.kcl',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    let testDir: string | undefined
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        await fsp.mkdir(join(dir, 'router-template-slate', 'nested'), {
          recursive: true,
        })
        await fsp.copyFile(
          executorInputPath('router-template-slate.kcl'),
          join(dir, 'router-template-slate', 'nested', 'slate.kcl')
        )
        await fsp.copyFile(
          executorInputPath('focusrite_scarlett_mounting_braket.kcl'),
          join(dir, 'router-template-slate', 'nested', 'bracket.kcl')
        )
        testDir = dir
      },
    })
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    page.on('console', console.log)

    await test.step('Open the project', async () => {
      await page.getByText('router-template-slate').click()
      await expect(page.getByTestId('loading')).toBeAttached()
      await expect(page.getByTestId('loading')).not.toBeAttached({
        timeout: 20_000,
      })

      // It actually loads.
      await expect(u.codeLocator).toContainText('mounting bracket')
      await expect(u.codeLocator).toContainText('const radius =')
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
        fsp.access(join(testDir, 'router-template-slate', 'main.kcl'))
      ).rejects.toThrow()
      // eslint-disable-next-line jest/no-conditional-expect
      await expect(
        fsp.access(join(testDir, 'router-template-slate', 'nested', 'main.kcl'))
      ).rejects.toThrow()
    }

    await electronApp.close()
  }
)

test(
  'Deleting projects, can delete individual project, can still create projects after deleting all',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
    })
    await page.setViewportSize({ width: 1200, height: 500 })

    page.on('console', console.log)

    const createProjectAndRenameItTest = async ({
      name,
      page,
    }: {
      name: string
      page: Page
    }) => {
      await test.step(`Create and rename project ${name}`, async () => {
        await createProjectAndRenameIt({ name, page })
      })
    }

    // we need to create the folders so that the order is correct
    // creating them ahead of time with fs tools means they all have the same timestamp
    await createProjectAndRenameItTest({ name: 'router-template-slate', page })
    await createProjectAndRenameItTest({ name: 'bracket', page })
    await createProjectAndRenameItTest({ name: 'lego', page })

    await test.step('delete the middle project, i.e. the bracket project', async () => {
      const project = page.getByText('bracket')

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
      await page.getByRole('button', { name: 'New project' }).click()
      await expect(page.getByText('Successfully created')).toBeVisible()
      await expect(page.getByText('Successfully created')).not.toBeVisible()
      await expect(page.getByText('project-000')).toBeVisible()
    })

    await electronApp.close()
  }
)

test(
  'Can load a file with CRLF line endings',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        const routerTemplateDir = join(dir, 'router-template-slate')
        await fsp.mkdir(routerTemplateDir, { recursive: true })

        const file = await fsp.readFile(
          executorInputPath('router-template-slate.kcl'),
          'utf-8'
        )
        // Replace both \r optionally so we don't end up with \r\r\n
        const fileWithCRLF = file.replace(/\r?\n/g, '\r\n')
        await fsp.writeFile(
          join(routerTemplateDir, 'main.kcl'),
          fileWithCRLF,
          'utf-8'
        )
      },
    })
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    page.on('console', console.log)

    await page.getByText('router-template-slate').click()
    await expect(page.getByTestId('loading')).toBeAttached()
    await expect(page.getByTestId('loading')).not.toBeAttached({
      timeout: 20_000,
    })

    await expect(u.codeLocator).toContainText('routerDiameter')
    await expect(u.codeLocator).toContainText('templateGap')
    await expect(u.codeLocator).toContainText('minClampingDistance')

    await electronApp.close()
  }
)

test(
  'Can sort projects on home page',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
    })
    await page.setViewportSize({ width: 1200, height: 500 })

    const getAllProjects = () => page.getByTestId('project-link').all()

    page.on('console', console.log)

    const createProjectAndRenameItTest = async ({
      name,
      page,
    }: {
      name: string
      page: Page
    }) => {
      await test.step(`Create and rename project ${name}`, async () => {
        await createProjectAndRenameIt({ name, page })
      })
    }

    // we need to create the folders so that the order is correct
    // creating them ahead of time with fs tools means they all have the same timestamp
    await createProjectAndRenameItTest({ name: 'router-template-slate', page })
    await createProjectAndRenameItTest({ name: 'bracket', page })
    await createProjectAndRenameItTest({ name: 'lego', page })

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

    await electronApp.close()
  }
)

test(
  'When the project folder is empty, user can create new project and open it.',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({ testInfo })
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    page.on('console', console.log)

    // expect to see text "No Projects found"
    await expect(page.getByText('No Projects found')).toBeVisible()

    await page.getByRole('button', { name: 'New project' }).click()

    await expect(page.getByText('Successfully created')).toBeVisible()
    await expect(page.getByText('Successfully created')).not.toBeVisible()

    await expect(page.getByText('project-000')).toBeVisible()

    await page.getByText('project-000').click()

    await expect(page.getByTestId('loading')).toBeAttached()
    await expect(page.getByTestId('loading')).not.toBeAttached({
      timeout: 20_000,
    })

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeEnabled({
      timeout: 20_000,
    })

    await page.locator('.cm-content')
      .fill(`const sketch001 = startSketchOn('XZ')
  |> startProfileAt([-87.4, 282.92], %)
  |> line([324.07, 27.199], %, $seg01)
  |> line([118.328, -291.754], %)
  |> line([-180.04, -202.08], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(200, sketch001)`)

    const pointOnModel = { x: 660, y: 250 }

    // gray at this pixel means the stream has loaded in the most
    // user way we can verify it (pixel color)
    await expect
      .poll(() => u.getGreatestPixDiff(pointOnModel, [143, 143, 143]), {
        timeout: 10_000,
      })
      .toBeLessThan(15)

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
      page.getByRole('button', { name: 'New project' })
    ).toBeVisible()

    const createProject = async (projectNum: number) => {
      await page.getByRole('button', { name: 'New project' }).click()
      await expect(page.getByText('Successfully created')).toBeVisible()
      await expect(page.getByText('Successfully created')).not.toBeVisible()

      const projectNumStr = projectNum.toString().padStart(3, '0')
      await expect(page.getByText(`project-${projectNumStr}`)).toBeVisible()
    }
    for (let i = 1; i <= 10; i++) {
      await createProject(i)
    }
    await electronApp.close()
  }
)

test(
  'Opening a project should successfully load the stream, (regression test that this also works when switching between projects)',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        await Promise.all([
          fsp.mkdir(join(dir, 'router-template-slate'), { recursive: true }),
          fsp.mkdir(join(dir, 'bracket'), { recursive: true }),
        ])
        await Promise.all([
          fsp.copyFile(
            join(
              'src',
              'wasm-lib',
              'tests',
              'executor',
              'inputs',
              'router-template-slate.kcl'
            ),
            join(dir, 'router-template-slate', 'main.kcl')
          ),
          fsp.copyFile(
            join(
              'src',
              'wasm-lib',
              'tests',
              'executor',
              'inputs',
              'focusrite_scarlett_mounting_braket.kcl'
            ),
            join(dir, 'bracket', 'main.kcl')
          ),
        ])
      },
    })
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    page.on('console', console.log)

    const pointOnModel = { x: 630, y: 280 }

    await test.step('Opening the bracket project should load the stream', async () => {
      // expect to see the text bracket
      await expect(page.getByText('bracket')).toBeVisible()

      await page.getByText('bracket').click()

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
      await expect(page.getByText('New Project')).toBeVisible()
    })

    await test.step('Opening the router-template project should load the stream', async () => {
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

    await test.step('Opening the router-template project should load the stream', async () => {
      await page.getByTestId('project-sidebar-toggle').click()
      await expect(
        page.getByRole('button', { name: 'Go to Home' })
      ).toBeVisible()
      await page.getByRole('button', { name: 'Go to Home' }).click()

      await expect(page.getByRole('link', { name: 'bracket' })).toBeVisible()
      await expect(page.getByText('router-template-slate')).toBeVisible()
      await expect(page.getByText('New Project')).toBeVisible()
    })

    await electronApp.close()
  }
)

test(
  'You can change the root projects directory and nothing is lost',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        await Promise.all([
          fsp.mkdir(`${dir}/router-template-slate`, { recursive: true }),
          fsp.mkdir(`${dir}/bracket`, { recursive: true }),
        ])
        await Promise.all([
          fsp.copyFile(
            'src/wasm-lib/tests/executor/inputs/router-template-slate.kcl',
            `${dir}/router-template-slate/main.kcl`
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

    // we'll grab this from the settings on screen before we switch
    let originalProjectDirName: string
    const newProjectDirName = testInfo.outputPath(
      'electron-test-projects-dir-2'
    )
    if (fs.existsSync(newProjectDirName)) {
      await fsp.rm(newProjectDirName, { recursive: true })
    }

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

      // Can't use Playwright filechooser since this is happening in electron.
      const handleFile = electronApp.evaluate(
        async ({ dialog }, filePaths) => {
          dialog.showOpenDialog = () =>
            Promise.resolve({ canceled: false, filePaths })
        },
        [newProjectDirName]
      )
      await page.getByTestId('project-directory-button').click()
      await handleFile

      await expect(page.locator('section#projectDirectory input')).toHaveValue(
        newProjectDirName
      )

      await page.getByTestId('settings-close-button').click()

      await expect(page.getByText('No Projects found')).toBeVisible()
      await page.getByRole('button', { name: 'New project' }).click()
      await expect(page.getByText('Successfully created')).toBeVisible()
      await expect(page.getByText('Successfully created')).not.toBeVisible()

      await expect(page.getByText(`project-000`)).toBeVisible()
    })

    await test.step('We can change back to the original root project directory', async () => {
      await expect(
        page.getByTestId('project-directory-settings-link')
      ).toBeVisible()

      await page.getByTestId('project-directory-settings-link').click()

      const handleFile = electronApp.evaluate(
        async ({ dialog }, filePaths) => {
          dialog.showOpenDialog = () =>
            Promise.resolve({ canceled: false, filePaths })
        },
        [originalProjectDirName]
      )
      await expect(page.getByTestId('project-directory-button')).toBeVisible()

      await page.getByTestId('project-directory-button').click()
      await handleFile

      await expect(page.locator('section#projectDirectory input')).toHaveValue(
        originalProjectDirName
      )

      await page.getByTestId('settings-close-button').click()

      await expect(page.getByText('bracket')).toBeVisible()
      await expect(page.getByText('router-template-slate')).toBeVisible()
    })

    await electronApp.close()
  }
)

test(
  'Search projects on desktop home',
  { tag: '@electron' },
  async ({ browserName: _ }, testInfo) => {
    const projectData = [
      ['basic bracket', 'focusrite_scarlett_mounting_braket.kcl'],
      ['basic-cube', 'basic_fillet_cube_end.kcl'],
      ['basic-cylinder', 'cylinder.kcl'],
      ['router-template-slate', 'router-template-slate.kcl'],
      ['Ancient Temple Block', 'lego.kcl'],
    ]
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        // Do these serially to ensure the order is correct
        for (const [name, file] of projectData) {
          await fsp.mkdir(join(dir, name), { recursive: true })
          await fsp.copyFile(
            executorInputPath(file),
            join(dir, name, `main.kcl`)
          )
        }
      },
    })
    await page.setViewportSize({ width: 1200, height: 500 })

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

    await electronApp.close()
  }
)

test(
  'file pane is scrollable when there are many files',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        const testDir = join(dir, 'testProject')
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
          'helix_ccw.kcl',
          'helix_defaults.kcl',
          'helix_defaults_negative_extrude.kcl',
          'helix_with_length.kcl',
          'i_shape.kcl',
          'kittycad_svg.kcl',
          'lego.kcl',
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
            join(testDir, fileName)
          )
        }
      },
    })

    await page.setViewportSize({ width: 1200, height: 500 })

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

    await electronApp.close()
  }
)

test(
  'select all in code editor does not actually select all, just what is visible (regression)',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        // src/wasm-lib/tests/executor/inputs/mike_stress_test.kcl
        const name = 'mike_stress_test'
        const testDir = join(dir, name)
        await fsp.mkdir(testDir, { recursive: true })
        await fsp.copyFile(
          executorInputPath(`${name}.kcl`),
          join(testDir, 'main.kcl')
        )
      },
    })
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

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

    await electronApp.close()
  }
)

test(
  'Settings persist across restarts',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    await test.step('We can change a user setting like theme', async () => {
      const { electronApp, page } = await setupElectron({
        testInfo,
      })
      await page.setViewportSize({ width: 1200, height: 500 })

      page.on('console', console.log)

      await page.getByTestId('user-sidebar-toggle').click()

      await page.getByTestId('user-settings').click()

      await expect(page.getByTestId('app-theme')).toHaveValue('dark')

      await page.getByTestId('app-theme').selectOption('light')

      await electronApp.close()
    })

    await test.step('Starting the app again and we can see the same theme', async () => {
      let { electronApp, page } = await setupElectron({
        testInfo,
        cleanProjectDir: false,
      })
      await page.setViewportSize({ width: 1200, height: 500 })

      page.on('console', console.log)

      await page.getByTestId('user-sidebar-toggle').click()

      await page.getByTestId('user-settings').click()

      await expect(page.getByTestId('app-theme')).toHaveValue('light')

      await electronApp.close()
    })
  }
)

test(
  'Original project name persist after onboarding',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
    })
    await page.setViewportSize({ width: 1200, height: 500 })

    const getAllProjects = () => page.getByTestId('project-link').all()
    page.on('console', console.log)

    await test.step('Should create and name a project called wrist brace', async () => {
      await createProjectAndRenameIt({ name: 'wrist brace', page })
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

    await electronApp.close()
  }
)
