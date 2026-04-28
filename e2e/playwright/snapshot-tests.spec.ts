import type { Page } from '@playwright/test'
import type { Fixtures } from '@e2e/playwright/fixtures/fixtureSetup'
import { lowerRightMasks, settingsToToml } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import { SETTINGS_FILE_NAME } from '@src/lib/constants'
import { Themes } from '@src/lib/theme'

const VIEWPORT = { width: 1200, height: 900 } as const

const snapshotOpts = (page: Page) => ({
  maxDiffPixels: 100,
  mask: lowerRightMasks(page),
})

type SnapshotTestContext = Pick<
  Fixtures,
  'cmdBar' | 'editor' | 'toolbar' | 'scene' | 'fs' | 'folderSetupFn'
> & { page: Page }

function testBodyForTheme(mode: Themes) {
  return async ({
    page,
    cmdBar,
    scene,
    toolbar,
    editor,
    fs,
    folderSetupFn,
  }: SnapshotTestContext) => {
    await runTestForTheme(mode, {
      page,
      cmdBar,
      scene,
      toolbar,
      editor,
      fs,
      folderSetupFn,
    })
  }
}

test.beforeEach(async ({ page }) => {
  // Make the user avatar image always 404
  // so we see the fallback menu icon for all snapshot tests
  await page.route('https://lh3.googleusercontent.com/**', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'text/plain',
      body: 'Not Found!',
    })
  })
})

test(
  'Create a sketch in a new project: light theme',
  { tag: '@snapshot' },
  testBodyForTheme(Themes.Light)
)

test(
  'Create a sketch in a new project: dark theme',
  { tag: '@snapshot' },
  testBodyForTheme(Themes.Dark)
)

async function runTestForTheme(mode: Themes, ctx: SnapshotTestContext) {
  const { page, cmdBar, scene, toolbar, editor, fs, folderSetupFn } = ctx
  const tomlStr = settingsToToml({
    settings: {
      app: {
        onboarding_status: 'dismissed',
        appearance: {
          theme: mode,
        },
      },
    },
  })

  await folderSetupFn(async (dir: string) => {
    const userDir = await fs.join(
      await fs.getPath('appData'),
      'dev.zoo.modeling-app-local'
    )
    await fs.mkdir(userDir, { recursive: true })
    const userSettingsPath = await fs.resolve(userDir, SETTINGS_FILE_NAME)
    await fs.writeFile(userSettingsPath, new TextEncoder().encode(tomlStr))

    const projectDir = await fs.join(dir, 'demo-project')
    await fs.mkdir(projectDir, { recursive: true })
  })

  const buildName = (name: string) => `${name}-${mode}.png`

  const [rectCorner1] = scene.makeMouseHelpers(0.24, 0.28, {
    format: 'ratio',
  })
  const [rectCorner2] = scene.makeMouseHelpers(0.82, 0.52, {
    format: 'ratio',
  })

  await test.step('Create a project', async () => {
    await page.setViewportSize(VIEWPORT)
    await scene.settled(cmdBar)

    await toolbar.openFeatureTreePane()
    await editor.openPane()

    await expect(page).toHaveScreenshot(
      buildName('01-project-created'),
      snapshotOpts(page)
    )
  })

  await test.step('Start a sketch', async () => {
    await toolbar.startSketchOnDefaultPlane('Front plane')

    await expect(page).toHaveScreenshot(
      buildName('02-sketch-started'),
      snapshotOpts(page)
    )
  })

  await test.step('Draw a rectangle', async () => {
    await toolbar.rectangleBtn.click()
    await rectCorner1()
    await rectCorner2()

    await expect(page).toHaveScreenshot(
      buildName('03-sketch-drawn'),
      snapshotOpts(page)
    )
  })

  await test.step('Exit the sketch', async () => {
    await toolbar.exitSketchBtn.click()
    await expect(toolbar.startSketchBtn).not.toBeDisabled()
    await scene.settled(cmdBar)

    await expect(page).toHaveScreenshot(
      buildName('04-sketch-exited'),
      snapshotOpts(page)
    )
  })
}
