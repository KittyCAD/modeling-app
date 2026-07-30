import type { Fixtures } from '@e2e/playwright/fixtures/fixtureSetup'
import {
  PLAYWRIGHT_LAYOUT_SETTINGS,
  settingsToToml,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
import { Themes } from '@src/lib/theme'

const SCREENSHOT_SIZE = { width: 1200, height: 900 }

function screenshotName(step: number, name: string, mode: Themes) {
  return `${String(step).padStart(2, '0')}-${name}-${mode}.png`
}

const screenshotMasks = (page: Page) => [
  page.getByTestId(/network-toggle/),
  page.getByTestId('user-sidebar-toggle').locator('.avatar'),
]

const screenshotOptions = (page: Page) => ({
  maxDiffPixelRatio: 0.001,
  mask: screenshotMasks(page),
})

async function waitForThemeApplied(page: Page, mode: Themes) {
  const expectDark = mode === Themes.Dark
  await expect
    .poll(async () =>
      page.locator('body').evaluate((el) => el.classList.contains('dark'))
    )
    .toBe(expectDark)
}

test(
  'Create a sketch in a new project: light theme',
  { tag: '@snapshot' },
  runTestForTheme(Themes.Light)
)

test(
  'Create a sketch in a new project: dark theme',
  { tag: '@snapshot' },
  runTestForTheme(Themes.Dark)
)

type SnapshotTestContext = Pick<
  Fixtures,
  'cmdBar' | 'editor' | 'toolbar' | 'scene' | 'fs' | 'folderSetupFn'
> & { page: Page }

function runTestForTheme(mode: Themes) {
  return async ({
    page,
    scene,
    toolbar,
    editor,
    fs,
    folderSetupFn,
  }: SnapshotTestContext) => {
    const tomlStr = settingsToToml({
      settings: {
        ...PLAYWRIGHT_LAYOUT_SETTINGS,
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
      const userSettingsPath = await fs.resolve(userDir, 'settings.toml')
      await fs.writeFile(userSettingsPath, new TextEncoder().encode(tomlStr))

      const projectDir = await fs.join(dir, 'demo-project')
      await fs.mkdir(projectDir, { recursive: true })
    })

    const [rectCorner1] = scene.makeMouseHelpers(0.24, 0.28, {
      format: 'ratio',
    })
    const [rectCorner2] = scene.makeMouseHelpers(0.82, 0.52, {
      format: 'ratio',
    })

    await page.setViewportSize(SCREENSHOT_SIZE)
    await scene.settled()
    await waitForThemeApplied(page, mode)
    let step = 1

    await test.step('Create a project', async () => {
      await toolbar.openFeatureTreePane()
      await editor.openPane()

      await expect(page).toHaveScreenshot(
        screenshotName(step++, 'project-created', mode),
        screenshotOptions(page)
      )
    })

    await test.step('Start a sketch', async () => {
      await toolbar.startSketchOnDefaultPlane('Front plane')

      await expect(page).toHaveScreenshot(
        screenshotName(step++, 'sketch-started', mode),
        screenshotOptions(page)
      )
    })

    await test.step('Draw a rectangle', async () => {
      await toolbar.rectangleBtn.click()
      await rectCorner1()
      await rectCorner2()

      await expect(page).toHaveScreenshot(
        screenshotName(step++, 'sketch-drawn', mode),
        screenshotOptions(page)
      )
    })

    await test.step('Exit the sketch', async () => {
      await toolbar.exitSketchBtn.click()
      await expect(toolbar.startSketchBtn).not.toBeDisabled()
      await scene.settled()

      await expect(page).toHaveScreenshot(
        screenshotName(step++, 'sketch-exited', mode),
        screenshotOptions(page)
      )
    })
  }
}
