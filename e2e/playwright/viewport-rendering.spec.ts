import { TEST_SETTINGS_KEY } from '@e2e/playwright/storageStates'
import { settingsToToml, tomlToSettings } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test(
  'viewport rendering defaults, switches, and persists across reloads',
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
      app: {
        ...settings.settings?.app,
        appearance: { theme: 'light' },
      },
    }
    await page.addInitScript(
      ({ key, value }) => {
        // WebKit checks CORS before route interception. Keep announcements out
        // of this rendering test while leaving the engine connection live.
        const originalFetch = globalThis.fetch.bind(globalThis)
        globalThis.fetch = async (input, init) => {
          const url = new URL(
            input instanceof Request ? input.url : input,
            location.href
          )
          if (url.pathname === '/announcements') {
            return new Response(JSON.stringify({ items: [] }), {
              headers: { 'content-type': 'application/json' },
            })
          }
          return originalFetch(input, init)
        }
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
          '[settings.meta]\nid = "a3e7bfb3-df47-4c99-9e9c-b39b586a8615"\n[settings.modeling]\nviewport_rendering = "phosphor"\nenable_ssao = false\n'
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
    await expect(rendering).toHaveValue('ssao')
    await expect(rendering.locator('option:checked')).toHaveText(/Default/)
    await page.getByRole('radio', { name: 'This project' }).click()
    await expect(rendering).toHaveCount(0)
    await page.getByRole('radio', { name: 'User' }).click()

    for (const mode of ['noeffect', 'phosphor', 'retrocad']) {
      await scene.waitForExecutionDoneAfter(async () => {
        await rendering.selectOption(mode)
        await page.getByTestId('settings-close-button').click()
      })
      await scene.settled()
      await expect.poll(() => modes.at(-1)).toBe(mode)
      await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
      await openSettings()
      await expect(rendering).toHaveValue(mode)
    }

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

    await scene.waitForExecutionDoneAfter(async () => {
      await rendering.selectOption('ssao')
      await page.getByTestId('settings-close-button').click()
    })
    await scene.settled()
    await expect.poll(() => modes.at(-1)).toBe('ssao')
    await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
    await scene.expectPixelColor([249, 249, 249], backgroundPoint, 10, {
      format: 'ratio',
    })
    await openSettings()
    await expect(rendering).toHaveValue('ssao')
  }
)
