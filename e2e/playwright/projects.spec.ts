import { _electron as electron, test, expect } from '@playwright/test'
import { getUtils, setup, tearDown } from './test-utils'
import fs from 'fs/promises'
import { secrets } from './secrets'
import { join } from 'path'
import { tomlStringify } from 'lang/wasm'

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test(
  'When the project folder is empty, user can create new project and open it.',
  { tag: '@electron' },
  async ({ page: browserPage, context: browserContext }, testInfo) => {
    // create or otherwise clear the folder ./electron-test-projects-dir
    const settingsFileName = `./${testInfo.title
      .replace(/\s/gi, '-')
      .replace(/\W/gi, '')}`
    const projectDirName = settingsFileName + '-dir'
    try {
      await fs.rm(projectDirName, { recursive: true })
    } catch (e) {
      console.error(e)
    }

    await fs.mkdir(projectDirName)

    // get full path for ./electron-test-projects-dir
    const fullProjectPath = await fs.realpath(projectDirName)

    const electronApp = await electron.launch({
      args: ['.'],
    })
    const context = electronApp.context()
    const page = await electronApp.firstWindow()

    const electronTempDirectory = await page.evaluate(async () => {
      return await window.electron.getPath(
        'temp'
      )
    })
    const tempSettingsFilePath = join(electronTempDirectory, settingsFileName)
    const settingsOverrides = tomlStringify({
      app: {
        projectDirectory: fullProjectPath,
      },
    })

    if (settingsOverrides instanceof Error) {
      throw settingsOverrides
    }
    await fs.writeFile(tempSettingsFilePath + '.toml', settingsOverrides)

    console.log('from within test setup', {
      settingsFileName,
      fullPath: fullProjectPath,
      electronApp,
      page,
      settingsFilePath: tempSettingsFilePath + '.toml',
    })

    await setup(context, page, fullProjectPath)
    // Set local storage directly using evaluate

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await page.goto('http://localhost:3000/')

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

    // check the model loaded by checking it's grey
    await expect
      .poll(() => u.getGreatestPixDiff(pointOnModel, [132, 132, 132]), {
        timeout: 10_000,
      })
      .toBeLessThan(10)

    await page.mouse.click(pointOnModel.x, pointOnModel.y)
    // check user can interact with model by checking it turns yellow
    await expect
      .poll(() => u.getGreatestPixDiff(pointOnModel, [176, 180, 132]))
      .toBeLessThan(10)

    await electronApp.close()
  }
)
