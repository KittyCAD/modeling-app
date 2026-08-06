import {
  getChamferType,
  normalizeChamferDialogArguments,
} from '@src/lib/commandBarConfigs/chamferDialog'
import { describe, expect, it } from 'vitest'

describe('Chamfer dialog types', () => {
  it('infers the chamfer type from existing KCL arguments', () => {
    expect(getChamferType({})).toBe('equalDistance')
    expect(getChamferType({ secondLength: '3' })).toBe('twoDistances')
    expect(getChamferType({ angle: '45deg' })).toBe('distanceAndAngle')
  })

  it('prefers an explicit dialog type over inferred arguments', () => {
    expect(
      getChamferType({
        chamferType: 'equalDistance',
        secondLength: '3',
        angle: '45deg',
      })
    ).toBe('equalDistance')
  })

  it('submits only the equal-distance dimension for the default type', () => {
    const source = {
      chamferType: 'equalDistance',
      length: '5',
      secondLength: '3',
      angle: '45deg',
    }

    expect(normalizeChamferDialogArguments(source)).toMatchObject({
      chamferType: 'equalDistance',
      length: '5',
      secondLength: undefined,
      angle: undefined,
    })
    expect(source.secondLength).toBe('3')
  })

  it('maps asymmetric types onto compatible KCL arguments', () => {
    expect(
      normalizeChamferDialogArguments({
        chamferType: 'twoDistances',
        length: '5',
        secondLength: '3',
        angle: '45deg',
      })
    ).toMatchObject({
      secondLength: '3',
      angle: undefined,
    })

    expect(
      normalizeChamferDialogArguments({
        chamferType: 'distanceAndAngle',
        length: '5',
        secondLength: '3',
        angle: '45deg',
      })
    ).toMatchObject({
      secondLength: undefined,
      angle: '45deg',
    })
  })

  it('uses angle precedence for malformed existing arguments', () => {
    expect(getChamferType({ secondLength: '3', angle: '45deg' })).toBe(
      'distanceAndAngle'
    )
  })
})
