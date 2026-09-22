import { expect, test } from '@e2e/playwright/zoo-test'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'

test.use({ userFeatures: [OPFS_CLOUD_FEATURE_FLAG] })

test(
  'Tooltip popovers stay anchored when native CSS anchor positioning is unavailable',
  { tag: '@web' },
  async ({ page }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await page.evaluate(() => {
      const nativeSupports = CSS.supports.bind(CSS)
      Object.defineProperty(CSS, 'supports', {
        configurable: true,
        value: (property: string, value?: string) => {
          const declaration =
            value === undefined ? property : `${property}: ${value}`
          if (
            declaration.includes('position-anchor') ||
            declaration.includes('anchor(')
          ) {
            return false
          }
          return value === undefined
            ? nativeSupports(property)
            : nativeSupports(property, value)
        },
      })
    })
    await page.addStyleTag({
      content:
        '[role="tooltip"][popover] { position-anchor: none !important; }',
    })

    const helpButton = page.getByRole('button', {
      name: 'Help and resources',
    })
    await expect(helpButton).toBeVisible()

    await helpButton.hover()

    const tooltip = page
      .getByRole('tooltip')
      .filter({ hasText: 'Help and resources' })
    await expect(tooltip).toBeVisible()

    const boxes = await Promise.all([
      helpButton.boundingBox(),
      tooltip.boundingBox(),
    ])
    const [triggerBox, tooltipBox] = boxes

    expect(triggerBox).not.toBeNull()
    expect(tooltipBox).not.toBeNull()
    if (!triggerBox || !tooltipBox) return

    expect(
      Math.abs(
        tooltipBox.x + tooltipBox.width - (triggerBox.x + triggerBox.width)
      )
    ).toBeLessThanOrEqual(2)
    expect(
      Math.abs(tooltipBox.y + tooltipBox.height - triggerBox.y)
    ).toBeLessThanOrEqual(2)
  }
)
