import {
  getVisibleElementRect,
  getVisibleViewportRect,
} from '@src/lib/viewportElement'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const rect = ({
  left,
  top,
  width,
  height,
}: {
  left: number
  top: number
  width: number
  height: number
}): DOMRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  x: left,
  y: top,
  toJSON: () => ({}),
})

const setWindowSize = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  })
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: height,
  })
}

describe('viewportElement', () => {
  beforeEach(() => {
    setWindowSize(100, 80)
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  test('clips an overgrown engine element to the browser viewport', () => {
    const element = document.createElement('canvas')
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
      rect({ left: -4, top: 8, width: 112, height: 40 })
    )

    expect(getVisibleElementRect(element)).toEqual({
      left: 0,
      top: 8,
      width: 100,
      height: 40,
    })
  })

  test('clips an overgrown engine element to overflow-hidden ancestors', () => {
    const parent = document.createElement('div')
    const element = document.createElement('canvas')
    parent.style.overflow = 'hidden'
    parent.append(element)
    document.body.append(parent)

    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue(
      rect({ left: 20, top: 10, width: 60, height: 50 })
    )
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
      rect({ left: 16, top: 6, width: 68, height: 58 })
    )

    expect(getVisibleElementRect(element)).toEqual({
      left: 20,
      top: 10,
      width: 60,
      height: 50,
    })
  })

  test('returns the visible rect for the data-engine element', () => {
    const element = document.createElement('canvas')
    element.setAttribute('data-engine', '')
    document.body.append(element)
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
      rect({ left: 10, top: 12, width: 30, height: 40 })
    )

    expect(getVisibleViewportRect()).toEqual({
      left: 10,
      top: 12,
      width: 30,
      height: 40,
    })
  })

  test('falls back to the window when no data-engine element exists', () => {
    expect(getVisibleViewportRect()).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 80,
    })
  })
})
