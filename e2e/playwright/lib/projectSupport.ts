import { closeOnboardingModalIfPresent } from '@e2e/playwright/lib/appSetup'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

export async function createProject({
  name,
  page,
  returnHome = false,
}: {
  name: string
  page: Page
  returnHome?: boolean
}) {
  await test.step(`Create project and navigate to it`, async () => {
    await page.getByRole('button', { name: 'Create project' }).click()
    await page.getByTestId('cmd-bar-arg-value').fill(name)
    await page.getByRole('button', { name: 'Continue' }).click()

    await closeOnboardingModalIfPresent(page)

    if (returnHome) {
      await page.waitForURL('**/file/**', { waitUntil: 'domcontentloaded' })
      await page.getByTestId('app-logo').click()
    }
  })
}

export async function goToHomePageFromModeling(page: Page) {
  await page.getByTestId('app-logo').click()
  await expect(
    page.getByRole('heading', { name: 'Project Libraries' })
  ).toBeVisible()
}
