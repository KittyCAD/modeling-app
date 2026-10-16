import { expect, test, type Locator } from '@playwright/test'
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

async function hudGeometry(target: Locator) {
  return target.evaluate((element) => {
    const visualRow =
      element.shadowRoot!.querySelector<HTMLElement>('[part="row"]')!
    const junction =
      element.shadowRoot!.querySelector<HTMLElement>('[part="junction"]')!
    const rowRect = visualRow.getBoundingClientRect()
    const dot = junction.getBoundingClientRect()
    const incoming = getComputedStyle(visualRow, '::before')
    const outgoing = getComputedStyle(visualRow, '::after')
    const rtl = getComputedStyle(element).direction === 'rtl'
    const guideWidth = parseFloat(incoming.borderTopWidth)
    return {
      dotSize: dot.width,
      incomingY: rowRect.top + parseFloat(incoming.top) + guideWidth / 2,
      incomingX: rtl
        ? rowRect.right - parseFloat(incoming.width)
        : rowRect.left + parseFloat(incoming.width),
      dotCenterY: dot.top + dot.height / 2,
      dotEdgeX: rtl ? dot.right : dot.left,
      outgoingX: rtl
        ? rowRect.right -
          parseFloat(outgoing.right) -
          parseFloat(outgoing.borderRightWidth) / 2
        : rowRect.left +
          parseFloat(outgoing.left) +
          parseFloat(outgoing.borderLeftWidth) / 2,
      outgoingY: rowRect.top + parseFloat(outgoing.top),
      dotCenterX: dot.left + dot.width / 2,
      dotBottom: dot.bottom,
    }
  })
}

for (const direction of ['ltr', 'rtl']) {
  for (const size of [6, 10]) {
    test(`HUD guides meet ${size}px junctions at their perimeter (${direction})`, async ({
      page,
    }) => {
      await page.goto(
        `/browser-tests/fixture.html${direction === 'rtl' ? '?rtl' : ''}`
      )
      await page.locator('zoo-feature-tree').evaluate((element, size) => {
        ;(element as HTMLElement).style.setProperty(
          '--zoo-tree-junction-size',
          `${size}px`
        )
      }, size)
      const geometry = await hudGeometry(row(page, 'sketch'))
      expect(geometry.dotSize).toBe(size)
      expect(Math.abs(geometry.incomingY - geometry.dotCenterY)).toBeLessThan(
        0.1
      )
      expect(Math.abs(geometry.incomingX - geometry.dotEdgeX)).toBeLessThan(0.1)
      expect(Math.abs(geometry.outgoingX - geometry.dotCenterX)).toBeLessThan(
        0.1
      )
      expect(Math.abs(geometry.outgoingY - geometry.dotBottom)).toBeLessThan(
        0.1
      )
    })
  }
}

test('nested selection and focus share one rectangle while narrow resizing preserves actions', async ({
  page,
}) => {
  await page.goto('/browser-tests/fixture.html')
  const sketch = row(page, 'sketch')
  await sketch.focus()
  const geometry = await sketch.evaluate((element) => {
    const visualRow = element.shadowRoot!.querySelector('[part="row"]')!
    const style = getComputedStyle(visualRow)
    const hostStyle = getComputedStyle(element)
    return {
      hostOutline: hostStyle.outlineStyle,
      rowOutline: style.outlineStyle,
      background: style.backgroundColor,
    }
  })
  expect(geometry.hostOutline).toBe('none')
  expect(geometry.rowOutline).toBe('solid')
  expect(geometry.background).not.toBe('rgba(0, 0, 0, 0)')
  const before = await sketch.locator('[part="row"]').first().boundingBox()
  await page.keyboard.press('ArrowDown')
  const after = await sketch.locator('[part="row"]').first().boundingBox()
  expect(after).toEqual(before)
  for (const width of [440, 220, 320]) {
    await page.locator('#mount').evaluate((element, width) => {
      ;(element as HTMLElement).style.width = `${width}px`
    }, width)
    const dimensions = await page
      .locator('zoo-feature-tree')
      .evaluate((element) => ({
        client: element.clientWidth,
        scroll: element.scrollWidth,
        right: element.getBoundingClientRect().right,
      }))
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client)
    const action = await page.locator('#edit').boundingBox()
    expect(action!.x + action!.width).toBeLessThanOrEqual(dimensions.right)
    await expect(page.locator('#edit')).toBeVisible()
  }
})
