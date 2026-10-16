import { expect, test } from '@playwright/test'
import type { ZooFeatureTree } from '../src/web-components/feature-tree'

const row = (page: import('@playwright/test').Page, id: string) =>
  page.locator(`zoo-feature-tree-row[node-id="${id}"]`)

test('Tab enters once, actions cycle with F2, and Escape returns to the row', async ({
  page,
}) => {
  await page.goto('/browser-tests/fixture.html')
  await page.locator('#before').focus()
  await page.keyboard.press('Tab')
  await expect(row(page, 'sketch')).toBeFocused()
  await page.keyboard.press('F2')
  await expect(page.locator('#visibility')).toBeFocused()
  await page.keyboard.press('F2')
  await expect(page.locator('#edit')).toBeFocused()
  await page.keyboard.press('F2')
  await expect(page.locator('#visibility')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(row(page, 'sketch')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator('#after')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(row(page, 'sketch')).toBeFocused()
})

test('inherited RTL inside an enclosing shadow root reverses horizontal navigation', async ({
  page,
}) => {
  await page.goto('/browser-tests/fixture.html?rtl&shadow')
  await page.locator('#before').focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Home')
  await expect(row(page, 'body')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(row(page, 'sketch')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(row(page, 'sketch')).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('ArrowRight')
  await expect(row(page, 'body')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(row(page, 'body')).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('ArrowLeft')
  await expect(row(page, 'body')).toHaveAttribute('aria-expanded', 'true')
})

test('collapse and removal recover focus without stealing focus from outside', async ({
  page,
}) => {
  await page.goto('/browser-tests/fixture.html?shadow')
  await page.locator('#before').focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('ArrowDown')
  await expect(row(page, 'line')).toBeFocused()
  await page.locator('zoo-feature-tree').evaluate((element) => {
    ;(element as HTMLElement & { expandedIds: string[] }).expandedIds = ['body']
  })
  await expect(row(page, 'sketch')).toBeFocused()
  await row(page, 'sketch').evaluate((element) => element.remove())
  await expect(row(page, 'body')).toBeFocused()
  await page.locator('#after').focus()
  await row(page, 'body').evaluate((element) => element.remove())
  await expect(page.locator('#after')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(row(page, 'fillet')).toBeFocused()
})

test('context requests cross the enclosing shadow root exactly once', async ({
  page,
}) => {
  await page.goto('/browser-tests/fixture.html?shadow')
  await page.evaluate(() => {
    const requests: unknown[] = []
    Object.assign(window, { requests })
    document.addEventListener('zoo-context-menu', (event) => {
      requests.push((event as CustomEvent).detail)
    })
  })
  await row(page, 'sketch').focus()
  await page.keyboard.press('Shift+F10')
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { requests: unknown[] }).requests
      )
    )
    .toEqual([
      expect.objectContaining({
        nodeId: 'sketch',
        clientX: expect.any(Number),
        clientY: expect.any(Number),
      }),
    ])
})

test('removing a focused slotted action restores focus to its row', async ({
  page,
}) => {
  await page.goto('/browser-tests/fixture.html?shadow')
  await row(page, 'sketch').focus()
  await page.keyboard.press('F2')
  await expect(page.locator('#visibility')).toBeFocused()
  await page.locator('#visibility').evaluate((element) => element.remove())
  await expect(row(page, 'sketch')).toBeFocused()
})

test('disabled rows remain reachable but cannot request selection', async ({
  page,
}) => {
  await page.goto('/browser-tests/fixture.html')
  await row(page, 'line').evaluate((element) =>
    element.setAttribute('disabled', '')
  )
  await page.evaluate(() => {
    const requests: unknown[] = []
    Object.assign(window, { requests })
    document.addEventListener('zoo-selection-change', (event) =>
      requests.push((event as CustomEvent).detail)
    )
  })
  await page.locator('#before').focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('ArrowDown')
  await expect(row(page, 'line')).toBeFocused()
  await expect(row(page, 'line')).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Space')
  await page.keyboard.press('Enter')
  expect(
    await page.evaluate(
      () => (window as unknown as { requests: unknown[] }).requests
    )
  ).toEqual([])
  await page.keyboard.press('ArrowDown')
  await expect(row(page, 'extrude')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(row(page, 'extrude')).toHaveAttribute('aria-selected', 'true')
})

test('reordering a focused subtree preserves focus and its single Tab stop', async ({
  page,
}) => {
  await page.goto('/browser-tests/fixture.html?shadow')
  await page.locator('#before').focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('ArrowDown')
  await expect(row(page, 'line')).toBeFocused()
  await row(page, 'sketch').evaluate((element) =>
    element.parentElement!.append(element)
  )
  await expect(row(page, 'line')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(row(page, 'sketch')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(row(page, 'extrude')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator('#after')).toBeFocused()
  await row(page, 'sketch').evaluate((element) =>
    element.parentElement!.prepend(element)
  )
  await expect(page.locator('#after')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(row(page, 'extrude')).toBeFocused()
})

test('slotted form controls keep native text editing when optional shortcuts use letters', async ({
  page,
}) => {
  await page.goto('/browser-tests/fixture.html?shadow')
  await row(page, 'sketch').evaluate((element) => {
    const input = document.createElement('input')
    input.id = 'rename'
    input.slot = 'actions'
    input.setAttribute('aria-label', 'Rename feature')
    element.append(input)
  })
  await page.locator('zoo-feature-tree').evaluate((element) => {
    ;(element as ZooFeatureTree).shortcuts = { focusActions: [{ key: 'a' }] }
  })
  await page.locator('#rename').focus()
  await page.keyboard.type('abc')
  await expect(page.locator('#rename')).toBeFocused()
  await expect(page.locator('#rename')).toHaveValue('abc')
  await page.keyboard.press('Home')
  await page.keyboard.press('Delete')
  await expect(page.locator('#rename')).toHaveValue('bc')
  await page.keyboard.press('Escape')
  await expect(row(page, 'sketch')).toBeFocused()
})

test('consumers can remap or disable shortcuts and invoke semantic actions', async ({
  page,
}) => {
  await page.goto('/browser-tests/fixture.html')
  const tree = page.locator('zoo-feature-tree')
  await tree.evaluate((element) => {
    ;(element as ZooFeatureTree).shortcuts = {
      focusActions: [{ key: 'a', alt: true }],
      focusRow: [{ key: 'b', alt: true }],
      requestContextMenu: [],
    }
  })
  await row(page, 'sketch').focus()
  await page.keyboard.press('F2')
  await expect(row(page, 'sketch')).toBeFocused()
  await page.keyboard.press('Alt+a')
  await expect(page.locator('#visibility')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('#visibility')).toBeFocused()
  await page.keyboard.press('Alt+b')
  await expect(row(page, 'sketch')).toBeFocused()
  await tree.evaluate((element) => {
    ;(element as ZooFeatureTree).shortcuts = false
  })
  await page.keyboard.press('Alt+a')
  await expect(row(page, 'sketch')).toBeFocused()
  expect(
    await tree.evaluate((element) => (element as ZooFeatureTree).focusActions())
  ).toBe(true)
  await expect(page.locator('#visibility')).toBeFocused()
  expect(
    await tree.evaluate((element) => (element as ZooFeatureTree).focusRow())
  ).toBe(true)
  await expect(row(page, 'sketch')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(row(page, 'line')).toBeFocused()
})
