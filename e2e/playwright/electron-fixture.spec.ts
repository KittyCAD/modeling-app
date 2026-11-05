import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Electron fixture reuse', { tag: '@desktop' }, () => {
  test.describe.configure({ mode: 'serial' })

  test('leaves project settings open', async ({ page, homePage }) => {
    await homePage.goToModelingScene()
    await page.keyboard.press('ControlOrMeta+,')
    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true })
    ).toBeVisible()
  })

  test('returns home after the previous test left settings open', async ({
    homePage,
  }) => {
    await homePage.expectIsCurrentPage()
  })
})
