import { test, expect } from '@playwright/test'
import { getUtils, setupElectron, tearDown } from './test-utils'
import fsp from 'fs/promises'

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test(
  'When the project folder is empty, user can create new project and open it.',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    test.skip(
      browserName === 'webkit',
      'Skip on Safari because `window.tearDown` does not work'
    )
    const { electronApp, page } = await setupElectron({ testInfo })
    const u = await getUtils(page)
    await page.goto('http://localhost:3000/')
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
  'Check you can go home with two different methods, and that switching between projects does not harm the stream',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    test.skip(
      browserName === 'webkit',
      'Skip on Safari because `window.tearDown` does not work'
    )
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        await Promise.all([
          fsp.mkdir(`${dir}/router-template-slate`, { recursive: true }),
          fsp.mkdir(`${dir}/bracket`, { recursive: true }),
        ])
        await Promise.all([
          fsp.copyFile(
            'e2e/playwright/kcl-samples/router-template-slate.kcl',
            `${dir}/router-template-slate/main.kcl`
          ),
          fsp.copyFile(
            'e2e/playwright/kcl-samples/bracket.kcl',
            `${dir}/bracket/main.kcl`
          ),
        ])
      },
    })
    const u = await getUtils(page)
    await page.goto('http://localhost:3000/')
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

      await expect(page.getByText('bracket')).toBeVisible()
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

      await expect(page.getByText('bracket')).toBeVisible()
      await expect(page.getByText('router-template-slate')).toBeVisible()
      await expect(page.getByText('New Project')).toBeVisible()
    })

    await electronApp.close()
  }
)
