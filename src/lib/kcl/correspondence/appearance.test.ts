import { expect, it } from 'vitest'
import {
  correspondenceStyle,
  oklchToSrgb,
} from '@src/lib/kcl/correspondence/appearance'

it('keeps a view hue stable across repeated use and gives parallel source views distinct hues', () => {
  const view = {},
    first = correspondenceStyle(view)
  const styles = Array.from({ length: 8 }, () => correspondenceStyle({}))
  expect(correspondenceStyle(view).color).toEqual(first.color)
  expect(
    new Set([first, ...styles].map((style) => style.color.join(','))).size
  ).toBe(9)
  expect(first.fillOpacity).toBeLessThan(0.1)
  expect(first.outlineOpacity).toBeLessThan(0.5)
  expect(
    [first, ...styles].every((style) =>
      style.color.every((channel) => channel >= 0 && channel <= 1)
    )
  ).toBe(true)
})
it('converts known Oklab red and neutral endpoints into display sRGB', () => {
  const red = oklchToSrgb(0.6279553606, 0.2576833077, 29.233885192)
  expect(red[0]).toBeCloseTo(1, 5)
  expect(red[1]).toBeCloseTo(0, 5)
  expect(red[2]).toBeCloseTo(0, 5)
  expect(oklchToSrgb(0, 0, 0)).toEqual([0, 0, 0])
  for (const channel of oklchToSrgb(1, 0, 0)) expect(channel).toBeCloseTo(1, 5)
})
