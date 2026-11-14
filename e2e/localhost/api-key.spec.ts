import { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'
import { FsFixture } from '@e2e/playwright/fixtures/fsFixture'
import { expect, test } from '@e2e/playwright/base-test'

test('uses local projects with the localhost API key without requiring a cloud account @web', async ({
  context,
  page,
}) => {
  const cloudRequests: string[] = []
  await context.addInitScript(() => {
    localStorage.setItem('playwright', 'true')
    localStorage.setItem(
      '/settings.toml',
      '[settings.app]\nonboarding_status = \"dismissed\"\n'
    )
  })
  await context.route('https://api.zoo.dev/**', async (route) => {
    if (new URL(route.request().url()).pathname.startsWith('/user/projects'))
      cloudRequests.push(route.request().method())
    if (new URL(route.request().url()).pathname === '/announcements') {
      await route.fulfill({ json: { items: [] } })
      return
    }
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Invalid API token' }),
    })
  })
  await context.routeWebSocket('**/ws/modeling/commands**', () => {})
  await page.goto('/home')
  const home = new HomePageFixture(page)
  await page.waitForFunction(() =>
    window.app?.settings.actor.getSnapshot().matches('idle')
  )
  await home.projectsLoaded()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Local Projects',
    { timeout: 30_000 }
  )
  await expect(page.getByTestId('home-new-file')).toBeVisible()
  const showEditor = async () => {
    const toggle = page.getByRole('switch', {
      name: 'Code Editor',
      exact: true,
    })
    await toggle.waitFor()
    if ((await toggle.getAttribute('aria-checked')) !== 'true')
      await toggle.click()
  }
  await home.createAndGoToProject('Local engine regression')
  await showEditor()
  const editor = page.locator('.cm-content').first()
  await expect(editor).toBeVisible()
  const code = '@settings(kclVersion = 3.0)\nwidth = 42\n'
  await editor.fill(code)
  const path = await page.evaluate(
    () =>
      window.app.project!.files.find((file) => file.path.endsWith('/main.kcl'))!
        .path
  )
  const fs = FsFixture(page)
  await expect.poll(() => fs.readFile(path, 'utf8')).toBe(code)
  await page.reload()
  await showEditor()
  await expect(editor).toContainText('width = 42')
  await page.getByTestId('app-logo').click()
  await home.projectsLoaded()
  await expect(
    home.projectCard.filter({ hasText: 'Local engine regression' })
  ).toBeVisible()
  expect(cloudRequests).toEqual([])
})
