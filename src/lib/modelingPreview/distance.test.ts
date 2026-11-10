import { literalDistance } from '@src/lib/modelingPreview/distance'
import { describe, expect, it } from 'vitest'

describe('drag distances', () => {
  it.each([
    ['-2in', 'mm', -50.8],
    ['5', 'cm', 50],
    ['1e-3m', 'mm', 1],
    ['.5ft', 'mm', 152.4],
  ])('converts %s using %s to millimeters', (text, unit, millimeters) => {
    expect(literalDistance(text, unit)?.millimeters).toBeCloseTo(millimeters)
  })
  it.each(['height', 'height + 2mm', '1deg', 'Infinity', '1e999mm', ''])(
    'does not replace %s by dragging',
    (text) => {
      expect(literalDistance(text, 'mm')).toBeUndefined()
    }
  )
})
