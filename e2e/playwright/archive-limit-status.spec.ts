import JSZip from 'jszip'
import { expect, test } from '@e2e/playwright/base-test'
import { mockCloudStorage } from '@e2e/playwright/lib/cloudStorageFixture'
import { mockClientErrorReports, setup } from '@e2e/playwright/test-utils'

for (const limit of ['entries', 'bytes'] as const) {
  test(
    `requires dismissal of the ${limit} limit toast on Home`,
    { tag: ['@web', '@browsers'] },
    async ({ context, page }, testInfo) => {
      await mockClientErrorReports(context)
      await mockCloudStorage(context)
      await setup(context, page, testInfo)
      const zip = new JSZip()
      if (limit === 'entries') {
        for (let i = 0; i < 10_001; i++) zip.file(`${i}.kcl`, '')
      } else {
        zip.file('main.kcl', '')
      }
      const body = await zip.generateAsync({ type: 'nodebuffer' })
      if (limit === 'bytes') {
        for (let i = 0; i + 46 <= body.length; i++) {
          if (body.readUInt32LE(i) === 0x02014b50) {
            body.writeUInt32LE(1024 * 1024 * 1024 + 1, i + 24)
            break
          }
        }
      }
      await context.route('**/user/projects/**/download*', (route) =>
        route.fulfill({ contentType: 'application/zip', body })
      )
      await page.goto('/home')
      const project = page.getByText('Cloud memory model', { exact: true })
      await expect(project).toBeVisible({ timeout: 60_000 })
      await project.dblclick()
      const message = page.getByRole('alert')
      await expect(message).toContainText(
        limit === 'bytes' ? '1 GiB' : '10,000'
      )
      await expect(message).toContainText('Reduce')
      await page.setViewportSize({ width: 900, height: 800 })
      const support = message.getByRole('link', { name: 'Contact support' })
      await expect(support).toHaveAttribute(
        'href',
        'https://community.zoo.dev/'
      )
      await expect(support).toBeInViewport()
      await expect(
        page
          .getByTestId('app-header')
          .getByRole('button', { name: /Project exceeds/ })
      ).toHaveCount(0)
      await page.clock.install()
      await page.clock.fastForward(60_000)
      await page.keyboard.press('Escape')
      await expect(message).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath(`archive-limit-${limit}-toast.png`),
      })
      await support.focus()
      await page.keyboard.press('Tab')
      await expect(
        page.getByRole('button', { name: 'Dismiss', exact: true })
      ).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(message).toHaveCount(0)
    }
  )
}
