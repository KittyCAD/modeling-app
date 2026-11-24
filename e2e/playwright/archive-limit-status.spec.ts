import JSZip from 'jszip'
import { expect, test } from '@e2e/playwright/base-test'
import { mockCloudStorage } from '@e2e/playwright/lib/cloudStorageFixture'
import { mockClientErrorReports, setup } from '@e2e/playwright/test-utils'

test(
  'offers recovery in the header when opening a project with too many archive entries',
  { tag: ['@web', '@browsers'] },
  async ({ context, page }, testInfo) => {
    await mockClientErrorReports(context)
    await mockCloudStorage(context)
    await setup(context, page, testInfo)
    const zip = new JSZip()
    for (let i = 0; i < 10_001; i++) zip.file(`${i}.kcl`, '')
    const body = await zip.generateAsync({ type: 'nodebuffer' })
    await context.route('**/user/projects/**/download*', (route) =>
      route.fulfill({ contentType: 'application/zip', body })
    )
    await page.goto('/home')
    await page.getByText('Cloud memory model', { exact: true }).dblclick()
    const header = page.getByTestId('app-header')
    const message = header.getByRole('button', {
      name: 'Project exceeds 10,000 entries',
    })
    await expect(message).toBeVisible()
    await page.setViewportSize({ width: 900, height: 800 })
    await expect(message).toBeInViewport()
    await message.click()
    await expect(header).toContainText('Reduce')
    const support = header.getByRole('link', { name: 'Contact support' })
    await expect(support).toHaveAttribute('href', 'https://community.zoo.dev/')
    await expect(support).toBeInViewport()
    await expect(header.getByRole('button', { name: /Retry/ })).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath('archive-limit-header.png'),
    })
    await page.keyboard.press('Escape')
    await expect(support).not.toBeVisible()
    await header
      .getByRole('button', { name: 'Dismiss archive limit message' })
      .click()
    await expect(message).toHaveCount(0)
  }
)
