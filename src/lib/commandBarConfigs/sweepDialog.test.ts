import {
  getSweepProfileOrientation,
  getSweepProfilePosition,
  hasLegacySweepAlignment,
  normalizeSweepDialogArguments,
} from '@src/lib/commandBarConfigs/sweepDialog'
import { describe, expect, it } from 'vitest'

describe('Sweep dialog modes', () => {
  it('uses the recommended alignment defaults for a new sweep', () => {
    expect(getSweepProfilePosition({})).toBe('original')
    expect(getSweepProfileOrientation({})).toBe('original')
    expect(normalizeSweepDialogArguments({})).toMatchObject({
      profilePosition: 'original',
      profileOrientation: 'original',
      translateProfileToPath: false,
      orientProfilePerpendicular: false,
    })
  })

  it.each([
    ['original', 'original', false, false],
    ['original', 'perpendicular', false, true],
    ['path', 'original', true, false],
    ['path', 'perpendicular', true, true],
  ] as const)(
    'maps %s position and %s orientation to independent sweep flags',
    (profilePosition, profileOrientation, translate, orient) => {
      expect(
        normalizeSweepDialogArguments({
          profilePosition,
          profileOrientation,
        })
      ).toMatchObject({
        profilePosition,
        profileOrientation,
        translateProfileToPath: translate,
        orientProfilePerpendicular: orient,
      })
    }
  )

  it('preserves a missing flag in a partially authored modern edit', () => {
    const normalized = normalizeSweepDialogArguments({
      nodeToEdit: [],
      orientProfilePerpendicular: true,
    })

    expect(normalized).toMatchObject({
      profilePosition: undefined,
      profileOrientation: 'perpendicular',
      translateProfileToPath: undefined,
      orientProfilePerpendicular: true,
    })
  })

  it('preserves an old edit with no authored alignment flags', () => {
    const normalized = normalizeSweepDialogArguments({
      nodeToEdit: [],
      version: { valueText: '1' },
    })

    expect(normalized).toMatchObject({
      profilePosition: undefined,
      profileOrientation: undefined,
      translateProfileToPath: undefined,
      orientProfilePerpendicular: undefined,
    })
  })

  it.each(['SKETCH_PLANE', 'TRAJECTORY'] as const)(
    'preserves legacy %s alignment without conflicting modern flags',
    (relativeTo) => {
      const source = {
        nodeToEdit: [],
        relativeTo,
        profilePosition: 'path',
        profileOrientation: 'perpendicular',
        translateProfileToPath: true,
        orientProfilePerpendicular: true,
      }
      const normalized = normalizeSweepDialogArguments(source)

      expect(hasLegacySweepAlignment(source)).toBe(true)
      expect(getSweepProfilePosition(source)).toBeUndefined()
      expect(getSweepProfileOrientation(source)).toBeUndefined()
      expect(normalized).toMatchObject({
        relativeTo,
        profilePosition: undefined,
        profileOrientation: undefined,
        translateProfileToPath: undefined,
        orientProfilePerpendicular: undefined,
      })
      expect(source).toMatchObject({
        profilePosition: 'path',
        profileOrientation: 'perpendicular',
        translateProfileToPath: true,
        orientProfilePerpendicular: true,
      })
      expect(normalized).not.toBe(source)
    }
  )
})
