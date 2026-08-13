import { expect, test } from '@e2e/playwright/zoo-test'

test(
  'Toolbar dropdowns stay anchored when showPopover ignores its source',
  { tag: '@web' },
  async ({ page }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- preserve the native implementation before replacing the prototype method.
      const nativeShowPopover = HTMLElement.prototype.showPopover
      Object.defineProperty(HTMLElement.prototype, 'showPopover', {
        configurable: true,
        value: function (this: HTMLElement) {
          nativeShowPopover.call(this)
        },
      })
    })

    const trigger = page.locator(
      '[data-onboarding-id="booleans-dropdown-button"]'
    )
    await expect(trigger).toBeVisible()
    await trigger.click()

    const menuItem = page.getByTestId('dropdown-boolean-union')
    await expect(menuItem).toBeVisible()

    const panel = page.locator('[popover="manual"]', { has: menuItem })
    const [triggerBox, panelBox] = await Promise.all([
      trigger.boundingBox(),
      panel.boundingBox(),
    ])

    expect(triggerBox).not.toBeNull()
    expect(panelBox).not.toBeNull()
    if (!triggerBox || !panelBox) return

    expect(
      Math.abs(
        panelBox.x + panelBox.width / 2 - (triggerBox.x + triggerBox.width / 2)
      )
    ).toBeLessThanOrEqual(2)
    expect(
      Math.abs(panelBox.y - (triggerBox.y + triggerBox.height + 16))
    ).toBeLessThanOrEqual(2)
  }
)
