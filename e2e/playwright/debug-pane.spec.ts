import { getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

function countNewlines(input: string): number {
  let count = 0
  for (const char of input) {
    if (char === '\n') {
      count++
    }
  }
  return count
}

test.describe('Debug pane', { tag: '@desktop' }, () => {
  test('Artifact IDs in the artifact graph are stable across code edits', async ({
    page,
    context,
    homePage,
  }) => {
    const code = `sketch001 = startSketchOn(XZ)
    |> startProfile(at = [0, 0])
  `
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    const tree = page.getByTestId('debug-feature-tree')
    const segment = tree.locator('li', {
      hasText: 'segIds:',
      hasNotText: 'paths:',
    })

    await test.step('Test setup', async () => {
      await homePage.goToModelingScene()
      await u.openKclCodePanel()
      await u.openDebugPanel()
      // Set the code in the code editor.
      await u.codeLocator.click()
      await page.keyboard.type(code, { delay: 0 })
      // Scroll to the artifact graph.
      await tree.scrollIntoViewIfNeeded()
      // Expand the artifact graph.
      await tree.getByText('Artifact Graph').click()
      // Just expanded the details, making the element taller, so scroll again.
      await tree.getByText('plane').first().scrollIntoViewIfNeeded()
    })
    await test.step('Move cursor to the bottom of the code editor', async () => {
      // Focus on the code editor.
      await u.codeLocator.click()
      // Make sure the cursor is at the end of the code.
      const lines = countNewlines(code) + 1
      for (let i = 0; i < lines; i++) {
        await page.keyboard.press('ArrowDown')
      }
    })
    let lastSegmentText = await segment.innerText()
    // TODO: if you type all the code at once without delay (or paste it in)
    // the initial segment artifact ID is different. This appears to be niche bug
    // that is being sidestepped in this test until https://github.com/KittyCAD/modeling-app/issues/9609 is addressed.
    await test.step('Enter a line', async () => {
      await page.keyboard.type('|> line(end = [1, 1])', { delay: 10 })
      // Wait for keyboard input debounce and updated artifact graph.
      await page.waitForTimeout(1000)
    })
    await expect(segment).not.toHaveText(lastSegmentText)
    // The artifact ID should include a UUID.
    const uuidRegexp =
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
    await expect(segment).toHaveText(uuidRegexp)
    const uuid = (await segment.innerText()).match(uuidRegexp)!

    await test.step('Enter another line', async () => {
      lastSegmentText = await segment.innerText()
      await page.keyboard.type('\n|> line(end = [2, 2])', { delay: 10 })
      // Wait for keyboard input debounce and updated artifact graph.
      await page.waitForTimeout(1000)
    })

    // Expect the artifact IDs to be changed (by adding another),
    await expect(segment).not.toHaveText(lastSegmentText)
    // but still contain the stable first ID.
    await expect(segment).toContainText(uuid)
  })
})
