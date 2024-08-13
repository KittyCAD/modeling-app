import { _electron as electron, test, expect } from '@playwright/test'
import { getUtils, tearDown } from './test-utils'
import fs from 'node:fs'
import { secrets } from './secrets'

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test(
  'When the project folder is empty, user can create new project and open it.',
  { tag: '@electron' },
  async () => {
    // create or otherwise clear the folder ./electron-test-projects-dir
    const fileName = './electron-test-projects-dir'
    try {
      fs.rmdirSync(fileName, { recursive: true })
    } catch (e) {
      console.error(e)
    }

    fs.mkdirSync(fileName)

    // get full path for ./electron-test-projects-dir
    const fullPath = fs.realpathSync(fileName)

    const electronApp = await electron.launch({
      args: ['.'],
    })

    await electronApp.evaluate(async ({ app }) => {
      return app.getAppPath()
    })

    const page = await electronApp.firstWindow()

    // Set local storage directly using evaluate
    await page.evaluate(
      (token) => localStorage.setItem('TOKEN_PERSIST_KEY', token),
      secrets.token
    )
    await page.evaluate(
      (fullPath) =>
        localStorage.setItem(
          'APP_SETTINGS_OVERRIDE',
          JSON.stringify({
            projectDirectory: fullPath,
          })
        ),
      fullPath
    )

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
