import { TEST_SETTINGS_KEY } from '@e2e/playwright/storageStates'
import { settingsToToml, tomlToSettings } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test(
  'shared SSAO and cloud rendering styles persist across reloads',
  { tag: '@web' },
  async ({ page, folderSetupFn, fs, homePage, scene }) => {
    // The shared fixture disables SSAO. Remove that override to test the default.
    const settings = tomlToSettings(
      await page.evaluate(
        (key) => localStorage.getItem(key) || '',
        TEST_SETTINGS_KEY
      )
    )
    delete settings.settings?.modeling?.enable_ssao
    settings.settings = {
      ...settings.settings,
      modeling: {
        ...settings.settings?.modeling,
        use_local_renderer: false,
      },
      app: {
        ...settings.settings?.app,
        appearance: { theme: 'light' },
      },
    }
    // WebKit reports startup fetches interrupted by a reload as CORS errors.
    // Let those requests finish before either of the setup reloads.
    await page.waitForLoadState('networkidle')
    await page.addInitScript(
      ({ key, value }) => {
        // The shared fixture resets user settings on reload. Restore the app's
        // saved settings so this test can exercise persistence too.
        const savedKey = 'viewport-rendering-saved-settings'
        localStorage.setItem(key, sessionStorage.getItem(savedKey) ?? value)
        window.addEventListener('beforeunload', () => {
          sessionStorage.setItem(savedKey, localStorage.getItem(key) ?? value)
        })
      },
      { key: TEST_SETTINGS_KEY, value: settingsToToml(settings) }
    )
    await page.waitForLoadState('networkidle')

    await folderSetupFn(async (dir) => {
      const project = await fs.join(dir, 'viewport-rendering')
      await fs.mkdir(project, { recursive: true })
      await fs.writeFile(
        await fs.join(project, 'main.kcl'),
        new TextEncoder().encode(`// Rendering preview
// A cylinder for checking viewport styles.
@settings(kclVersion = 3.0, defaultLengthUnit = mm)
profile = sketch(on = XY) {
  rim = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([rim.center, ORIGIN])
  horizontal([rim.start, rim.center])
  radius(rim) == 10mm
}
disk = region(point = [0, 0], sketch = profile)
cylinder = extrude(disk, length = 10)
hide(profile)
`)
      )
      // A project override from the early preview must not pin the shader.
      await fs.writeFile(
        await fs.join(project, 'project.toml'),
        new TextEncoder().encode(
          '[settings.meta]\nid = "a3e7bfb3-df47-4c99-9e9c-b39b586a8615"\n[settings.modeling]\nviewport_rendering = "phosphor"\n'
        )
      )
    })

    const modes: (string | null)[] = []
    page.on('websocket', (socket) => {
      const url = new URL(socket.url())
      if (url.searchParams.has('video_res_width')) {
        modes.push(url.searchParams.get('post_effect'))
      }
    })
    const rendering = page.getByTestId('modeling-viewportRendering')
    const openSettings = async () => {
      await page.getByRole('link', { name: 'Settings' }).last().click()
      await page.getByRole('radio', { name: 'User' }).click()
    }

    await homePage.openProject('viewport-rendering')
    await scene.settled()
    expect(modes).toEqual(['ssao'])
    const backgroundPoint = { x: 0.9, y: 0.3 }
    await scene.expectPixelColor([249, 249, 249], backgroundPoint, 10, {
      format: 'ratio',
    })
    await openSettings()
    await expect(
      page.getByRole('heading', { name: 'Rendering style', exact: true })
    ).toBeVisible()
    await expect(rendering).toHaveValue('default')
    await expect(rendering.locator('option')).toHaveText([
      'Default',
      'Retro CAD',
      'Phosphor',
    ])
    const ssao = page.locator('input[name="modeling-enableSSAO"]')
    const toggleSSAO = () => page.locator('label').filter({ has: ssao }).click()
    await expect(ssao).toBeChecked()

    for (const mode of ['phosphor', 'retrocad']) {
      const connectionCount = modes.length
      await scene.waitForExecutionDoneAfter(async () => {
        await rendering.selectOption(mode)
        await expect(ssao).not.toBeChecked()
        await page.getByTestId('settings-close-button').click()
      })
      await scene.settled()
      expect(modes.slice(connectionCount)).toEqual([mode])
      await scene.expectPixelColor([0, 0, 0], backgroundPoint, 10, {
        format: 'ratio',
      })
      await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
      await openSettings()
      await expect(rendering).toHaveValue(mode)

      await scene.waitForExecutionDoneAfter(async () => {
        await toggleSSAO()
        await expect(rendering).toHaveValue('default')
        await page.getByTestId('settings-close-button').click()
      })
      await scene.settled()
      expect(modes.slice(connectionCount)).toEqual([mode, 'ssao'])
      await scene.expectPixelColor([249, 249, 249], backgroundPoint, 10, {
        format: 'ratio',
      })
      await openSettings()
      await expect(ssao).toBeChecked()
    }
    await scene.waitForExecutionDoneAfter(async () => {
      await rendering.selectOption('retrocad')
      await page.getByTestId('settings-close-button').click()
    })
    await scene.settled()
    await openSettings()
    await expect(ssao).not.toBeChecked()

    const search = page.getByPlaceholder(/^Search settings/)
    await search.fill('Rendering style')
    await expect(
      page.getByRole('option', { name: /Rendering style/ })
    ).toBeVisible()
    await search.press('Escape')
    await search.fill('')
    const connectionCount = modes.length
    const localRenderer = page.locator(
      'input[name="modeling-useLocalRenderer"]'
    )
    await page.locator('label').filter({ has: localRenderer }).click()
    await expect(localRenderer).toBeChecked()
    await expect(page.getByTestId('viewportRendering')).toHaveCount(0)
    await expect(page.getByTestId('enableSSAO')).toBeVisible()
    await toggleSSAO()
    await expect(ssao).toBeChecked()
    await search.fill('Rendering style')
    await expect(
      page.getByRole('option', { name: /Rendering style/ })
    ).toHaveCount(0)
    await search.press('Escape')
    await search.fill('')
    await toggleSSAO()
    await expect(ssao).not.toBeChecked()
    await page.locator('label').filter({ has: localRenderer }).click()
    await expect(localRenderer).not.toBeChecked()
    await expect(rendering).toHaveValue('retrocad')
    await expect(page.getByTestId('enableSSAO')).toBeVisible()
    await page.waitForFunction(() =>
      window.app.settings.actor.getSnapshot().matches('idle')
    )
    expect(modes).toHaveLength(connectionCount)
    await page.getByTestId('settings-close-button').click()

    modes.length = 0
    await page.reload()
    await scene.settled()
    expect(modes).toEqual(['retrocad'])
    await scene.expectPixelColor([0, 0, 0], backgroundPoint, 10, {
      format: 'ratio',
    })
    await openSettings()
    await expect(rendering).toHaveValue('retrocad')
    await expect(ssao).not.toBeChecked()
    await page.getByRole('radio', { name: 'This project' }).click()
    await expect(rendering).toHaveCount(0)
    await page.getByRole('radio', { name: 'User' }).click()

    await scene.waitForExecutionDoneAfter(async () => {
      await rendering.selectOption('default')
      await page.getByTestId('settings-close-button').click()
    })
    await scene.settled()
    await expect.poll(() => modes.at(-1)).toBe('noeffect')
    await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
    await scene.expectPixelColor([249, 249, 249], backgroundPoint, 10, {
      format: 'ratio',
    })
    await openSettings()
    await expect(rendering).toHaveValue('default')
  }
)
