import { expect, test } from '@e2e/playwright/base-test'
import { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'

for (const autoSelect of [false, true]) {
  test(
    `project fixture enters a library when automatic selection is ${autoSelect ? 'pending' : 'absent'}`,
    { tag: '@web' },
    async ({ page }) => {
      await page.route('**/__home_fixture__', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><a href="#/library/projects" aria-label="Open Projects library">Projects</a>',
        })
      )
      await page.goto('/__home_fixture__')
      await page.evaluate((autoSelect) => {
        Object.defineProperty(window, 'app', {
          value: {
            settings: {
              actor: { getSnapshot: () => ({ matches: () => true }) },
            },
          },
        })
        const showProjects = () => {
          document.body.innerHTML =
            '<button aria-label="Refresh projects" aria-busy="false">Refresh</button><a data-testid="project-link" href="#/file/main.kcl">Project</a>'
        }
        const link = document.querySelector('a')
        link?.addEventListener('click', (event) => {
          event.preventDefault()
          showProjects()
        })
        // Reproduce the app selecting its sole library between pointer movement
        // and click dispatch. The setup helper must accept the resulting grid.
        if (autoSelect) link?.addEventListener('pointerover', showProjects)
      }, autoSelect)
      const home = new HomePageFixture(page)
      await home.projectsLoaded()
      await expect(page.getByTestId('project-link')).toBeVisible()
      await home.projectsLoaded()
    }
  )
}
