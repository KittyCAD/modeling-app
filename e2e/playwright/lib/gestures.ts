import type { Locator, Page } from '@playwright/test'

export const deg = (Math.PI * 2) / 360

/**
 * Moves the mouse in a sine wave along a vector,
 * useful for emulating organic fluid mouse motion which is not available normally in Playwright.
 * Ex. used to activate the segment overlays by hovering around the sketch segments.
 */
export const wiggleMove = async (
  page: any,
  x: number,
  y: number,
  steps: number,
  dist: number,
  ang: number,
  amplitude: number,
  freq: number,
  locator?: string
) => {
  const tau = Math.PI * 2
  const deg = tau / 360
  const step = dist / steps
  for (let i = 0, j = 0; i < dist; i += step, j += 1) {
    if (locator) {
      const isElVis = await page.locator(locator).isVisible()
      if (isElVis) return
    }
    // x1 is 0.
    const y1 = Math.sin((tau / steps) * j * freq) * amplitude
    const [x2, y2] = [
      Math.cos(-ang * deg) * i - Math.sin(-ang * deg) * y1,
      Math.sin(-ang * deg) * i + Math.cos(-ang * deg) * y1,
    ]
    const [xr, yr] = [x2, y2]
    await page.mouse.move(x + xr, y + yr, { steps: 5 })
  }
}

/**
 * Moves the mouse in a complete circle about a point.
 * useful for emulating organic "hovering" around motions, which are not available normally in Playwright.
 * Ex. used to activate the segment overlays by hovering around the sketch segments.
 */
export const circleMove = async (
  page: Page,
  x: number,
  y: number,
  steps: number,
  diameter: number,
  locator?: string
) => {
  const tau = Math.PI * 2
  const step = tau / steps
  for (let i = 0; i < tau; i += step) {
    if (locator) {
      const isElVis = await page.locator(locator).isVisible()
      if (isElVis) return
    }
    const [x1, y1] = [Math.cos(i) * diameter, Math.sin(i) * diameter]
    const [xr, yr] = [x1, y1]
    await page.mouse.move(x + xr, y + yr, { steps: 5 })
  }
}

export const getMovementUtils = (opts: any) => {
  // The way we truncate is kinda odd apparently, so we need this function
  // "[k]itty[c]ad round"
  const kcRound = (n: number) => Math.trunc(n * 100) / 100

  // To translate between screen and engine ("[U]nit") coordinates
  // NOTE: these pretty much can't be perfect because of screen scaling.
  // Handle on a case-by-case.
  const toU = (x: number, y: number) => [
    kcRound(x * 0.0678),
    kcRound(-y * 0.0678), // Y is inverted in our coordinate system
  ]

  // Turn the array into a string with specific formatting
  const fromUToString = (xy: number[]) => `[${xy[0]}, ${xy[1]}]`

  // Combine because used often
  const toSU = (xy: number[]) => fromUToString(toU(xy[0], xy[1]))

  // Make it easier to click around from center ("click [from] zero zero")
  const click00 = (x: number, y: number) =>
    opts.page.mouse.click(opts.center.x + x, opts.center.y + y, { delay: 100 })

  // Relative clicker, must keep state
  let last = { x: 0, y: 0 }
  const click00r = async (x?: number, y?: number) => {
    // reset relative coordinates when anything is undefined
    if (x === undefined || y === undefined) {
      last.x = 0
      last.y = 0
      return
    }

    await circleMove(
      opts.page,
      opts.center.x + last.x + x,
      opts.center.y + last.y + y,
      10,
      10
    )
    await click00(last.x + x, last.y + y)
    last.x += x
    last.y += y

    // Returns the new absolute coordinate if you need it.
    return [last.x, last.y]
  }

  return { toSU, toU, click00r }
}

/**
 * Simulate a pan touch gesture from the center of an element.
 *
 * Adapted from Playwright docs: https://playwright.dev/docs/touch-events
 */
export async function panFromCenter(
  locator: Locator,
  deltaX = 0,
  deltaY = 0,
  steps = 5
) {
  const { centerX, centerY } = await locator.evaluate((target: HTMLElement) => {
    const bounds = target.getBoundingClientRect()
    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2
    return { centerX, centerY }
  })

  // Providing only clientX and clientY as the app only cares about those.
  const touches = [
    {
      identifier: 0,
      clientX: centerX,
      clientY: centerY,
    },
  ]
  await locator.dispatchEvent('touchstart', {
    touches,
    changedTouches: touches,
    targetTouches: touches,
  })

  for (let j = 1; j <= steps; j++) {
    const touches = [
      {
        identifier: 0,
        clientX: centerX + (deltaX * j) / steps,
        clientY: centerY + (deltaY * j) / steps,
      },
    ]
    await locator.dispatchEvent('touchmove', {
      touches,
      changedTouches: touches,
      targetTouches: touches,
    })
  }

  await locator.dispatchEvent('touchend')
}

/**
 * Simulate a 2-finger pan touch gesture from the center of an element.
 * with {touchSpacing} pixels between.
 *
 * Adapted from Playwright docs: https://playwright.dev/docs/touch-events
 */
export async function panTwoFingerFromCenter(
  locator: Locator,
  deltaX = 0,
  deltaY = 0,
  steps = 5,
  spacingX = 20
) {
  const { centerX, centerY } = await locator.evaluate((target: HTMLElement) => {
    const bounds = target.getBoundingClientRect()
    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2
    return { centerX, centerY }
  })

  // Providing only clientX and clientY as the app only cares about those.
  const touches = [
    {
      identifier: 0,
      clientX: centerX,
      clientY: centerY,
    },
    {
      identifier: 1,
      clientX: centerX + spacingX,
      clientY: centerY,
    },
  ]
  await locator.dispatchEvent('touchstart', {
    touches,
    changedTouches: touches,
    targetTouches: touches,
  })

  for (let j = 1; j <= steps; j++) {
    const touches = [
      {
        identifier: 0,
        clientX: centerX + (deltaX * j) / steps,
        clientY: centerY + (deltaY * j) / steps,
      },
      {
        identifier: 1,
        clientX: centerX + spacingX + (deltaX * j) / steps,
        clientY: centerY + (deltaY * j) / steps,
      },
    ]
    await locator.dispatchEvent('touchmove', {
      touches,
      changedTouches: touches,
      targetTouches: touches,
    })
  }

  await locator.dispatchEvent('touchend')
}

/**
 * Simulate a pinch touch gesture from the center of an element.
 * Touch points are set horizontally from each other, separated by {startDistance} pixels.
 */
export async function pinchFromCenter(
  locator: Locator,
  startDistance = 100,
  delta = 0,
  steps = 5
) {
  const { centerX, centerY } = await locator.evaluate((target: HTMLElement) => {
    const bounds = target.getBoundingClientRect()
    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2
    return { centerX, centerY }
  })

  // Providing only clientX and clientY as the app only cares about those.
  const touches = [
    {
      identifier: 0,
      clientX: centerX - startDistance / 2,
      clientY: centerY,
    },
    {
      identifier: 1,
      clientX: centerX + startDistance / 2,
      clientY: centerY,
    },
  ]
  await locator.dispatchEvent('touchstart', {
    touches,
    changedTouches: touches,
    targetTouches: touches,
  })

  for (let i = 1; i <= steps; i++) {
    const touches = [
      {
        identifier: 0,
        clientX: centerX - startDistance / 2 + (delta * i) / steps,
        clientY: centerY,
      },
      {
        identifier: 1,
        clientX: centerX + startDistance / 2 + (delta * i) / steps,
        clientY: centerY,
      },
    ]
    await locator.dispatchEvent('touchmove', {
      touches,
      changedTouches: touches,
      targetTouches: touches,
    })
  }

  await locator.dispatchEvent('touchend')
}
