import { test, expect } from '@playwright/test'
import {
  doExport,
  getUtils,
  isOutOfViewInScrollContainer,
  Paths,
  setupElectron,
  tearDown,
} from './test-utils'
import fsp from 'fs/promises'
import fs from 'fs'
import { join } from 'path'
import { FILE_EXT } from 'lib/constants'

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
        await fsp.mkdir(join(dir, 'bracket'), { recursive: true })
        await fsp.copyFile(
          join(
            'src',
            'wasm-lib',
            'tests',
            'executor',
            'inputs',
            'focusrite_scarlett_mounting_braket.kcl'
          ),
          join(dir, 'bracket', 'main.kcl')
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
          join(
            'src',
            'wasm-lib',
            'tests',
            'executor',
            'inputs',
            'broken-code-test.kcl'
          ),
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
        test.skip(
          process.platform === 'win32',
          'TODO: remove this skip https://github.com/KittyCAD/modeling-app/issues/3557'
        )
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
            .toBe(477327)

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
test.fixme(
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

    await expect(page.getByTestId('loading')).toBeAttached()
    await expect(page.getByTestId('loading')).not.toBeAttached({
      timeout: 20_000,
    })
    await expect(u.codeLocator).toContainText(
      'A mounting bracket for the Focusrite Scarlett Solo audio interface'
    )

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

    const createProjectAndRenameIt = async (name: string) =>
      test.step(`Create and rename project ${name}`, async () => {
        await page.getByRole('button', { name: 'New project' }).click()
        await expect(page.getByText('Successfully created')).toBeVisible()
        await expect(page.getByText('Successfully created')).not.toBeVisible()

        await expect(page.getByText(`project-000`)).toBeVisible()
        await page.getByText(`project-000`).hover()
        await page.getByText(`project-000`).focus()

        await page.getByLabel('sketch').first().click()

        await page.waitForTimeout(100)

        // type "updated project name"
        await page.keyboard.press('Backspace')
        await page.keyboard.type(name)

        await page.getByLabel('checkmark').last().click()
      })

    // we need to create the folders so that the order is correct
    // creating them ahead of time with fs tools means they all have the same timestamp
    await createProjectAndRenameIt('router-template-slate')
    // await createProjectAndRenameIt('focusrite_scarlett_mounting_braket')
    await createProjectAndRenameIt('bracket')
    await createProjectAndRenameIt('lego')

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
  'Can sort projects on home page',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
    })
    await page.setViewportSize({ width: 1200, height: 500 })

    const getAllProjects = () => page.getByTestId('project-link').all()

    page.on('console', console.log)

    const createProjectAndRenameIt = async (name: string) =>
      test.step(`Create and rename project ${name}`, async () => {
        await page.getByRole('button', { name: 'New project' }).click()
        await expect(page.getByText('Successfully created')).toBeVisible()
        await expect(page.getByText('Successfully created')).not.toBeVisible()

        await expect(page.getByText(`project-000`)).toBeVisible()
        await page.getByText(`project-000`).hover()
        await page.getByText(`project-000`).focus()

        await page.getByLabel('sketch').first().click()

        await page.waitForTimeout(100)

        // type "updated project name"
        await page.keyboard.press('Backspace')
        await page.keyboard.type(name)

        await page.getByLabel('checkmark').last().click()
      })

    // we need to create the folders so that the order is correct
    // creating them ahead of time with fs tools means they all have the same timestamp
    await createProjectAndRenameIt('router-template-slate')
    // await createProjectAndRenameIt('focusrite_scarlett_mounting_braket')
    await createProjectAndRenameIt('bracket')
    await createProjectAndRenameIt('lego')

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
      .poll(() => u.getGreatestPixDiff(pointOnModel, [132, 132, 132]), {
        timeout: 10_000,
      })
      .toBeLessThan(10)

    await expect(async () => {
      await page.mouse.move(0, 0, { steps: 5 })
      await page.mouse.move(pointOnModel.x, pointOnModel.y, { steps: 5 })
      await page.mouse.click(pointOnModel.x, pointOnModel.y)
      // check user can interact with model by checking it turns yellow
      await expect
        .poll(() => u.getGreatestPixDiff(pointOnModel, [176, 180, 132]))
        .toBeLessThan(10)
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
        .poll(() => u.getGreatestPixDiff(pointOnModel, [132, 132, 132]), {
          timeout: 10_000,
        })
        .toBeLessThan(10)
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
    test.skip(
      process.platform === 'win32',
      'TODO: remove this skip https://github.com/KittyCAD/modeling-app/issues/3557'
    )
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
            join('src', 'wasm-lib', 'tests', 'executor', 'inputs', file),
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
    test.skip(
      process.platform === 'win32',
      'TODO: remove this skip https://github.com/KittyCAD/modeling-app/issues/3557'
    )
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        await fsp.mkdir(`${dir}/testProject`, { recursive: true })
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
          'member_expression_sketch_group.kcl',
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
            `src/wasm-lib/tests/executor/inputs/${fileName}`,
            `${dir}/testProject/${fileName}`
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
    test.skip(
      process.platform === 'win32',
      'TODO: remove this skip https://github.com/KittyCAD/modeling-app/issues/3557'
    )
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        // src/wasm-lib/tests/executor/inputs/mike_stress_test.kcl
        const name = 'mike_stress_test'
        await fsp.mkdir(`${dir}/${name}`, { recursive: true })
        await fsp.copyFile(
          `src/wasm-lib/tests/executor/inputs/${name}.kcl`,
          `${dir}/${name}/main.kcl`
        )
      },
    })
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    page.on('console', console.log)

    await page.getByText('mike_stress_test').click()

    const modifier =
      process.platform === 'win32' || process.platform === 'linux'
        ? 'Control'
        : 'Meta'

    await test.step('select all in code editor, check its length', async () => {
      await u.codeLocator.click()
      // expect u.codeLocator to have some text
      await expect(u.codeLocator).toContainText('line(')
      await page.keyboard.down(modifier)
      await page.keyboard.press('KeyA')
      await page.keyboard.up(modifier)

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

      await page.keyboard.down(modifier)
      await page.keyboard.press('KeyA')
      await page.keyboard.up(modifier)

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

test.describe('Renaming in the file tree', () => {
  test(
    'A file you have open',
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      test.skip(
        process.platform === 'win32',
        'TODO: remove this skip https://github.com/KittyCAD/modeling-app/issues/3557'
      )
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
          await fsp.mkdir(join(dir, 'Test Project'), { recursive: true })
          const exampleDir = join(
            'src',
            'wasm-lib',
            'tests',
            'executor',
            'inputs'
          )
          await fsp.copyFile(
            join(exampleDir, 'basic_fillet_cube_end.kcl'),
            join(dir, 'Test Project', 'main.kcl')
          )
          await fsp.copyFile(
            join(exampleDir, 'cylinder.kcl'),
            join(dir, 'Test Project', 'fileToRename.kcl')
          )
        },
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      // Constants and locators
      const projectLink = page.getByText('Test Project')
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const fileToRename = page
        .getByRole('listitem')
        .filter({ has: page.getByRole('button', { name: 'fileToRename.kcl' }) })
      const renamedFile = page
        .getByRole('listitem')
        .filter({ has: page.getByRole('button', { name: 'newFileName.kcl' }) })
      const renameMenuItem = page.getByRole('button', { name: 'Rename' })
      const renameInput = page.getByPlaceholder('fileToRename.kcl')
      const newFileName = 'newFileName'
      const codeLocator = page.locator('.cm-content')

      await test.step('Open project and file pane', async () => {
        await expect(projectLink).toBeVisible()
        await projectLink.click()
        await expect(projectMenuButton).toBeVisible()
        await expect(projectMenuButton).toContainText('main.kcl')

        await u.openFilePanel()
        await expect(fileToRename).toBeVisible()
        await fileToRename.click()
        await expect(projectMenuButton).toContainText('fileToRename.kcl')
        await u.openKclCodePanel()
        await expect(codeLocator).toContainText('circle(')
        await u.closeKclCodePanel()
      })

      await test.step('Rename the file', async () => {
        await fileToRename.click({ button: 'right' })
        await renameMenuItem.click()
        await expect(renameInput).toBeVisible()
        await renameInput.fill(newFileName)
        await page.keyboard.press('Enter')
      })

      await test.step('Verify the file is renamed', async () => {
        await expect(fileToRename).not.toBeAttached()
        await expect(renamedFile).toBeVisible()
      })

      await test.step('Verify we navigated', async () => {
        await expect(projectMenuButton).toContainText(newFileName + FILE_EXT)
        const url = page.url()
        expect(url).toContain(newFileName)
        await expect(projectMenuButton).not.toContainText('fileToRename.kcl')
        await expect(projectMenuButton).not.toContainText('main.kcl')
        expect(url).not.toContain('fileToRename.kcl')
        expect(url).not.toContain('main.kcl')

        await u.openKclCodePanel()
        await expect(codeLocator).toContainText('circle(')
      })

      await electronApp.close()
    }
  )

  test(
    'A file you do not have open',
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      test.skip(
        process.platform === 'win32',
        'TODO: remove this skip https://github.com/KittyCAD/modeling-app/issues/3557'
      )
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
          await fsp.mkdir(join(dir, 'Test Project'), { recursive: true })
          const exampleDir = join(
            'src',
            'wasm-lib',
            'tests',
            'executor',
            'inputs'
          )
          await fsp.copyFile(
            join(exampleDir, 'basic_fillet_cube_end.kcl'),
            join(dir, 'Test Project', 'main.kcl')
          )
          await fsp.copyFile(
            join(exampleDir, 'cylinder.kcl'),
            join(dir, 'Test Project', 'fileToRename.kcl')
          )
        },
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      // Constants and locators
      const newFileName = 'newFileName'
      const projectLink = page.getByText('Test Project')
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const fileToRename = page
        .getByRole('listitem')
        .filter({ has: page.getByRole('button', { name: 'fileToRename.kcl' }) })
      const renamedFile = page.getByRole('listitem').filter({
        has: page.getByRole('button', { name: newFileName + FILE_EXT }),
      })
      const renameMenuItem = page.getByRole('button', { name: 'Rename' })
      const renameInput = page.getByPlaceholder('fileToRename.kcl')
      const codeLocator = page.locator('.cm-content')

      await test.step('Open project and file pane', async () => {
        await expect(projectLink).toBeVisible()
        await projectLink.click()
        await expect(projectMenuButton).toBeVisible()
        await expect(projectMenuButton).toContainText('main.kcl')

        await u.openFilePanel()
        await expect(fileToRename).toBeVisible()
      })

      await test.step('Rename the file', async () => {
        await fileToRename.click({ button: 'right' })
        await renameMenuItem.click()
        await expect(renameInput).toBeVisible()
        await renameInput.fill(newFileName)
        await page.keyboard.press('Enter')
      })

      await test.step('Verify the file is renamed', async () => {
        await expect(fileToRename).not.toBeAttached()
        await expect(renamedFile).toBeVisible()
      })

      await test.step('Verify we have not navigated', async () => {
        await expect(projectMenuButton).toContainText('main.kcl')
        await expect(projectMenuButton).not.toContainText(
          newFileName + FILE_EXT
        )
        await expect(projectMenuButton).not.toContainText('fileToRename.kcl')

        const url = page.url()
        expect(url).toContain('main.kcl')
        expect(url).not.toContain(newFileName)
        expect(url).not.toContain('fileToRename.kcl')

        await u.openKclCodePanel()
        await expect(codeLocator).toContainText('fillet(')
      })

      await electronApp.close()
    }
  )

  test(
    `A folder you're not inside`,
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      test.skip(
        process.platform === 'win32',
        'TODO: remove this skip https://github.com/KittyCAD/modeling-app/issues/3557'
      )
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
          await fsp.mkdir(join(dir, 'Test Project'), { recursive: true })
          await fsp.mkdir(join(dir, 'Test Project', 'folderToRename'), {
            recursive: true,
          })
          const exampleDir = join(
            'src',
            'wasm-lib',
            'tests',
            'executor',
            'inputs'
          )
          await fsp.copyFile(
            join(exampleDir, 'basic_fillet_cube_end.kcl'),
            join(dir, 'Test Project', 'main.kcl')
          )
          await fsp.copyFile(
            join(exampleDir, 'cylinder.kcl'),
            join(dir, 'Test Project', 'folderToRename', 'someFileWithin.kcl')
          )
        },
      })

      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      // Constants and locators
      const projectLink = page.getByText('Test Project')
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const folderToRename = page.getByRole('button', {
        name: 'folderToRename',
      })
      const renamedFolder = page.getByRole('button', { name: 'newFolderName' })
      const renameMenuItem = page.getByRole('button', { name: 'Rename' })
      const renameInput = page.getByPlaceholder('folderToRename')
      const newFolderName = 'newFolderName'

      await test.step('Open project and file pane', async () => {
        await expect(projectLink).toBeVisible()
        await projectLink.click()
        await expect(projectMenuButton).toBeVisible()
        await expect(projectMenuButton).toContainText('main.kcl')

        const url = page.url()
        expect(url).toContain('main.kcl')
        expect(url).not.toContain('folderToRename')

        await u.openFilePanel()
        await expect(folderToRename).toBeVisible()
      })

      await test.step('Rename the folder', async () => {
        await folderToRename.click({ button: 'right' })
        await expect(renameMenuItem).toBeVisible()
        await renameMenuItem.click()
        await expect(renameInput).toBeVisible()
        await renameInput.fill(newFolderName)
        await page.keyboard.press('Enter')
      })

      await test.step('Verify the folder is renamed, and no navigation occurred', async () => {
        const url = page.url()
        expect(url).toContain('main.kcl')
        expect(url).not.toContain('folderToRename')

        await expect(projectMenuButton).toContainText('main.kcl')
        await expect(renamedFolder).toBeVisible()
        await expect(folderToRename).not.toBeAttached()
      })

      await electronApp.close()
    }
  )

  test(
    `A folder you are inside`,
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      test.skip(
        process.platform === 'win32',
        'TODO: remove this skip https://github.com/KittyCAD/modeling-app/issues/3557'
      )
      const exampleDir = join('src', 'wasm-lib', 'tests', 'executor', 'inputs')
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
          await fsp.mkdir(join(dir, 'Test Project'), { recursive: true })
          await fsp.mkdir(join(dir, 'Test Project', 'folderToRename'), {
            recursive: true,
          })
          await fsp.copyFile(
            join(exampleDir, 'basic_fillet_cube_end.kcl'),
            join(dir, 'Test Project', 'main.kcl')
          )
          await fsp.copyFile(
            join(exampleDir, 'cylinder.kcl'),
            join(dir, 'Test Project', 'folderToRename', 'someFileWithin.kcl')
          )
        },
      })

      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      // Constants and locators
      const projectLink = page.getByText('Test Project')
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const folderToRename = page.getByRole('button', {
        name: 'folderToRename',
      })
      const renamedFolder = page.getByRole('button', { name: 'newFolderName' })
      const fileWithinFolder = page.getByRole('listitem').filter({
        has: page.getByRole('button', { name: 'someFileWithin.kcl' }),
      })
      const renameMenuItem = page.getByRole('button', { name: 'Rename' })
      const renameInput = page.getByPlaceholder('folderToRename')
      const newFolderName = 'newFolderName'

      await test.step('Open project and navigate into folder', async () => {
        await expect(projectLink).toBeVisible()
        await projectLink.click()
        await expect(projectMenuButton).toBeVisible()
        await expect(projectMenuButton).toContainText('main.kcl')

        const url = page.url()
        expect(url).toContain('main.kcl')
        expect(url).not.toContain('folderToRename')

        await u.openFilePanel()
        await expect(folderToRename).toBeVisible()
        await folderToRename.click()
        await expect(fileWithinFolder).toBeVisible()
        await fileWithinFolder.click()

        await expect(projectMenuButton).toContainText('someFileWithin.kcl')
        const newUrl = page.url()
        expect(newUrl).toContain('folderToRename')
        expect(newUrl).toContain('someFileWithin.kcl')
        expect(newUrl).not.toContain('main.kcl')
      })

      await test.step('Rename the folder', async () => {
        await folderToRename.click({ button: 'right' })
        await expect(renameMenuItem).toBeVisible()
        await renameMenuItem.click()
        await expect(renameInput).toBeVisible()
        await renameInput.fill(newFolderName)
        await page.keyboard.press('Enter')
      })

      await test.step('Verify the folder is renamed, and navigated to new path', async () => {
        const urlSnippet = encodeURIComponent(
          join(newFolderName, 'someFileWithin.kcl')
        )
        await page.waitForURL(new RegExp(urlSnippet))
        await expect(projectMenuButton).toContainText('someFileWithin.kcl')
        await expect(renamedFolder).toBeVisible()
        await expect(folderToRename).not.toBeAttached()

        // URL is synchronous, so we check the other stuff first
        const url = page.url()
        expect(url).not.toContain('main.kcl')
        expect(url).toContain(newFolderName)
        expect(url).toContain('someFileWithin.kcl')
      })

      await electronApp.close()
    }
  )
})
