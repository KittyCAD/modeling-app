export type ViewportElementRect = {
  left: number
  top: number
  width: number
  height: number
}

type RectBounds = ViewportElementRect & {
  right: number
  bottom: number
}

const clipsOverflow = (value: string) =>
  value === 'auto' ||
  value === 'clip' ||
  value === 'hidden' ||
  value === 'scroll'

const boundsFromRect = (rect: DOMRect): RectBounds => ({
  left: rect.left,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
  width: rect.width,
  height: rect.height,
})

const rectFromBounds = (bounds: RectBounds): ViewportElementRect | null => {
  const width = Math.max(0, bounds.right - bounds.left)
  const height = Math.max(0, bounds.bottom - bounds.top)

  if (width <= 0 || height <= 0) {
    return null
  }

  return {
    left: bounds.left,
    top: bounds.top,
    width,
    height,
  }
}

export const getVisibleElementRect = (
  element: HTMLElement
): ViewportElementRect | null => {
  const elementRect = element.getBoundingClientRect()
  let bounds = boundsFromRect(elementRect)

  bounds = {
    left: Math.max(bounds.left, 0),
    top: Math.max(bounds.top, 0),
    right: Math.min(bounds.right, window.innerWidth),
    bottom: Math.min(bounds.bottom, window.innerHeight),
    width: 0,
    height: 0,
  }

  let parent = element.parentElement
  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent)
    const overflowX = style.overflowX || style.overflow
    const overflowY = style.overflowY || style.overflow
    const clipsX = clipsOverflow(overflowX)
    const clipsY = clipsOverflow(overflowY)

    if (clipsX || clipsY) {
      const parentRect = parent.getBoundingClientRect()
      if (clipsX) {
        bounds.left = Math.max(bounds.left, parentRect.left)
        bounds.right = Math.min(bounds.right, parentRect.right)
      }
      if (clipsY) {
        bounds.top = Math.max(bounds.top, parentRect.top)
        bounds.bottom = Math.min(bounds.bottom, parentRect.bottom)
      }
    }

    parent = parent.parentElement
  }

  return rectFromBounds(bounds)
}

export const getViewportElement = (): HTMLElement | null => {
  const viewport = document.querySelector('[data-engine]')
  return viewport instanceof HTMLElement ? viewport : null
}

export const getVisibleViewportRect = (): ViewportElementRect => {
  const viewport = getViewportElement()
  const visibleRect = viewport ? getVisibleElementRect(viewport) : null

  return (
    visibleRect ?? {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    }
  )
}
