import { describe, expect, it } from 'vitest'
import {
  backgroundColorFor,
  parseHexColor,
  systemColorFor,
} from '@src/features/engineScene/engineColors'

describe('engine colours', () => {
  it('sends channels as 0–1, not 0–255', () => {
    // Getting this wrong does not error: every channel saturates and the scene
    // comes back white.
    const dark = backgroundColorFor('dark')
    expect(dark.r).toBeCloseTo(28 / 255)
    expect(dark.a).toBe(1)
    expect(backgroundColorFor('light').r).toBeCloseTo(249 / 255)
  })

  it('draws overlay geometry in the opposite theme’s colour', () => {
    // Grid lines and axes sit on the background, so they contrast with it
    // rather than matching it.
    expect(systemColorFor('dark')).toEqual(backgroundColorFor('light'))
    expect(systemColorFor('light')).toEqual(backgroundColorFor('dark'))
  })

  it('parses both hex lengths', () => {
    expect(parseHexColor('#00D5FF')).toEqual({
      r: 0,
      g: 213 / 255,
      b: 1,
      a: 1,
    })
    expect(parseHexColor('0f8')).toEqual(parseHexColor('#00ff88'))
  })

  it('returns null for something it cannot read', () => {
    // The caller then leaves the engine's own default alone rather than
    // substituting a colour nobody chose.
    expect(parseHexColor('rebeccapurple')).toBeNull()
    expect(parseHexColor('#12345')).toBeNull()
    expect(parseHexColor('')).toBeNull()
  })
})
