import { describe, expect, it } from 'vitest'
import { lengthUnitOf, millimetres } from '@src/lib/kcl/units'

describe('millimetres', () => {
  it('converts the units an artifact reports', () => {
    expect(millimetres(1, 'in')).toBeCloseTo(25.4)
    expect(millimetres(2, 'cm')).toBe(20)
    expect(millimetres(3, 'mm')).toBe(3)
  })

  it('converts the suffixes a KCL number carries', () => {
    expect(millimetres(1, 'Inch')).toBeCloseTo(25.4)
    expect(millimetres(1, 'M')).toBe(1000)
  })

  it('leaves a number alone when its unit names no length', () => {
    // Already resolved by whoever produced it; there is nothing here to ask.
    expect(millimetres(5, 'None')).toBe(5)
    expect(millimetres(5, 'Deg')).toBe(5)
    expect(millimetres(5, null)).toBe(5)
  })
})

describe('lengthUnitOf', () => {
  it('maps the two vocabularies onto each other', () => {
    expect(lengthUnitOf('Ft')).toBe('ft')
    expect(lengthUnitOf('Count')).toBeNull()
  })
})
