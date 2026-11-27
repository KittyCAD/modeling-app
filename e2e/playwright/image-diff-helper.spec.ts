import { expect, test } from '@e2e/playwright/base-test'
import { doAndWaitForImageDiff } from '@e2e/playwright/test-utils'

test(
  'image diff rejects when its action closes the real page',
  { tag: '@web' },
  async ({ page }) => {
    test.setTimeout(5_000)

    await expect(
      doAndWaitForImageDiff(page, () => page.close())
    ).rejects.toThrow('Target page, context or browser has been closed')
  }
)
