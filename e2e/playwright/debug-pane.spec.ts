import { test, expect } from '@playwright/test'

import { getUtils, setup, tearDown } from './test-utils'

test.beforeEach(async ({ context, page }, testInfo) => {
  await setup(context, page, testInfo)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

function countNewlines(input: string): number {
  let count = 0
  for (const char of input) {
    if (char === '\n') {
      count++
    }
  }
  return count
}

test.describe('Debug pane', () => {
  test('Artifact IDs in the artifact graph are stable across code edits', async ({
    page,
    context,
  }) => {
    const code = `sketch001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
|> line([1, 1], %)
`
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    const tree = page.getByTestId('debug-feature-tree')
    const segment = tree.locator('li', {
      hasText: 'segIds:',
      hasNotText: 'paths:',
    })

    await test.step('Test setup', async () => {
      await u.waitForAuthSkipAppStart()
      await u.openKclCodePanel()
      await u.openDebugPanel()
      // Set the code in the code editor.
      await u.codeLocator.click()
      await page.keyboard.type(code, { delay: 0 })
      // Scroll to the feature tree.
      await tree.scrollIntoViewIfNeeded()
      // Expand the feature tree.
      await tree.getByText('Feature Tree').click()
      // Just expanded the details, making the element taller, so scroll again.
      await tree.getByText('Plane').first().scrollIntoViewIfNeeded()
    })
    // Extract the artifact IDs from the debug feature tree.
    const initialSegmentIds = await segment.innerText({ timeout: 5_000 })
    // The artifact ID should include a UUID.
    expect(initialSegmentIds).toMatch(
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
    )
    await test.step('Move cursor to the bottom of the code editor', async () => {
      // Focus on the code editor.
      await u.codeLocator.click()
      // Make sure the cursor is at the end of the code.
      const lines = countNewlines(code) + 1
      for (let i = 0; i < lines; i++) {
        await page.keyboard.press('ArrowDown')
      }
    })
    await test.step('Enter a comment', async () => {
      await page.keyboard.type('|> line([2, 2], %)', { delay: 0 })
      // Wait for keyboard input debounce and updated artifact graph.
      await page.waitForTimeout(1000)
    })
    const newSegmentIds = await segment.innerText()
    // Strip off the closing bracket.
    const initialIds = initialSegmentIds.slice(0, initialSegmentIds.length - 1)
    expect(newSegmentIds.slice(0, initialIds.length)).toEqual(initialIds)
  })
})
