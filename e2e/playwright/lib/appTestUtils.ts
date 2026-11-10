import { expect, type Page } from '@playwright/test'
import type { ProjectLibrarySetting } from '@src/lib/projectLibraries'
import { waitForAppLoad } from '@e2e/playwright/test-utils'

export async function navigateToAppRoute(page: Page, route: string) {
  if (process.env.TARGET === 'web') await page.goto(route)
  else {
    const url = new URL(page.url())
    url.hash = route
    await page.goto(url.toString())
    // Fragment navigation can retain the Electron document. Reload storage as
    // browser navigation does when testing direct entry into a route.
    await page.reload({ waitUntil: 'domcontentloaded' })
  }
}

export async function selectProjectLibraries(
  page: Page,
  libraries: ProjectLibrarySetting[]
) {
  await waitForAppLoad(page)
  await page.waitForFunction(() =>
    window.app.settings.actor.getSnapshot().matches('idle')
  )
  await page.evaluate((libraries) => {
    window.app.settings.actor.send({
      type: 'set.app.libraries',
      data: { level: 'user', value: libraries },
    })
  }, libraries)
  await page.waitForFunction(() =>
    window.app.settings.actor.getSnapshot().matches('idle')
  )
}

export async function installPausedClock(page: Page) {
  const time = new Date()
  await page.clock.install({ time })
  await page.clock.pauseAt(new Date(time.getTime() + 1_000))
}

/** Pause an installed clock after any time elapsed since its last resume. */
export async function pauseAppClock(page: Page) {
  await page.clock.pauseAt(
    new Date((await page.evaluate(() => Date.now())) + 1_000)
  )
}

export async function openLayoutPanes(page: Page, ...paneIds: string[]) {
  await page.evaluate((ids) => {
    for (const id of ids) window.app.layout.openPane(id)
  }, paneIds)
}

export async function openProjectLibrary(page: Page, title: string) {
  await page
    .getByRole('link', {
      name: `Open ${title} library`,
      exact: true,
    })
    .click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
}
