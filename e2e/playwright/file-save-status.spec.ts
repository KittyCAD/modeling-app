import { expect, test } from '@e2e/playwright/base-test'
import { mockClientErrorReports, setup } from '@e2e/playwright/lib/appSetup'
import { mockCloudStorage } from '@e2e/playwright/lib/cloudStorageFixture'

test(
  'keeps save progress and Retry beside the project title without shifting it',
  { tag: ['@web', '@browsers'] },
  async ({ context, page }, testInfo) => {
    await mockClientErrorReports(context)
    await mockCloudStorage(context)
    await setup(context, page, testInfo)
    const projectId = '12902000-0000-4000-8000-000000000091'
    const release = Promise.withResolvers<undefined>()
    let fail = true
    try {
      await page.goto(
        `/file/${encodeURIComponent(`/__zoo_cloud__/${projectId}/main.kcl`)}`
      )
      const editor = page.locator('.cm-content').first()
      await editor.waitFor({ state: 'visible', timeout: 60_000 })
      const header = page.getByTestId('app-header')
      const breadcrumb = page.getByTestId('project-sidebar-toggle')
      const before = await breadcrumb.boundingBox()
      expect(before).not.toBeNull()
      const historyButtons = page.getByTestId('app-header-undo-redo')
      const historyBefore = await historyButtons.boundingBox()
      expect(historyBefore).not.toBeNull()
      await expect(header.getByRole('status')).toHaveCount(0)
      await context.route(`**/user/projects/${projectId}`, async (route) => {
        if (route.request().method() === 'PUT') {
          await release.promise
          if (fail) {
            await route.fulfill({
              status: 500,
              json: { message: 'Save failed' },
            })
            return
          }
        }
        await route.fallback()
      })

      await editor.press('ControlOrMeta+End')
      await editor.press('Enter')
      await editor.pressSequentially('// edited contents')

      const status = header.getByRole('status')
      await expect(status).toHaveText('Saving...')
      await expect(
        status.getByRole('img', { name: 'Unsaved changes' })
      ).toBeVisible()
      await expect(page.locator('#statusbar')).not.toContainText('Saving...')
      const saving = await status.boundingBox()
      expect(saving).not.toBeNull()
      expect(saving!.x).toBeGreaterThanOrEqual(before!.x + before!.width)
      expect(saving!.x).toBeGreaterThanOrEqual(
        historyBefore!.x + historyBefore!.width
      )
      expect(await breadcrumb.boundingBox()).toEqual(before)
      expect(await historyButtons.boundingBox()).toEqual(historyBefore)
      await page.screenshot({
        path: testInfo.outputPath('save-status-saving.png'),
      })

      release.resolve(undefined)
      const retry = header.getByRole('button', { name: 'Save failed. Retry' })
      await expect(retry).toBeVisible()
      await expect(
        status.getByRole('img', { name: 'Unsaved changes' })
      ).toBeVisible()
      await page.setViewportSize({ width: 900, height: 800 })
      await expect(retry).toBeInViewport()

      fail = false
      await retry.click()
      await expect(status).toHaveCount(0)
      await expect(editor).toContainText('// edited contents')
    } finally {
      release.resolve(undefined)
    }
  }
)
