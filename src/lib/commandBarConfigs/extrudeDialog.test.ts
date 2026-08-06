import {
  getExtrudeDirectionMode,
  getExtrudeExtentType,
  normalizeExtrudeDialogArguments,
} from '@src/lib/commandBarConfigs/extrudeDialog'
import { describe, expect, it } from 'vitest'

const selectedFace = {
  graphSelections: [{ artifact: { type: 'wall' } }],
  otherSelections: [],
}

describe('Extrude dialog modes', () => {
  it('infers modes from existing KCL arguments', () => {
    expect(getExtrudeExtentType({ length: '5' })).toBe('distance')
    expect(getExtrudeExtentType({ to: selectedFace })).toBe('toFace')
    expect(getExtrudeDirectionMode({ length: '5' })).toBe('oneSide')
    expect(getExtrudeDirectionMode({ symmetric: true })).toBe('symmetric')
    expect(getExtrudeDirectionMode({ bidirectionalLength: '3' })).toBe(
      'twoSides'
    )
  })

  it('submits only a one-sided distance for the default mode', () => {
    const normalized = normalizeExtrudeDialogArguments({
      extentType: 'distance',
      directionMode: 'oneSide',
      length: '5',
      to: selectedFace,
      symmetric: true,
      bidirectionalLength: '3',
    })

    expect(normalized).toMatchObject({
      extentType: 'distance',
      directionMode: 'oneSide',
      length: '5',
      to: undefined,
      symmetric: undefined,
      bidirectionalLength: undefined,
    })
  })

  it('maps symmetric and two-sided modes onto compatible KCL arguments', () => {
    expect(
      normalizeExtrudeDialogArguments({
        extentType: 'distance',
        directionMode: 'symmetric',
        length: '5',
        bidirectionalLength: '3',
      })
    ).toMatchObject({
      symmetric: true,
      bidirectionalLength: undefined,
    })

    expect(
      normalizeExtrudeDialogArguments({
        extentType: 'distance',
        directionMode: 'twoSides',
        length: '5',
        symmetric: true,
        bidirectionalLength: '3',
      })
    ).toMatchObject({
      symmetric: undefined,
      bidirectionalLength: '3',
    })
  })

  it('removes distance-only geometry controls for a to-face extent', () => {
    const source = {
      extentType: 'toFace',
      directionMode: 'twoSides',
      length: '5',
      to: selectedFace,
      symmetric: true,
      bidirectionalLength: '3',
      direction: { graphSelections: [{}], otherSelections: [] },
      draftAngle: '2deg',
      twistAngle: '30deg',
      twistAngleStep: '5deg',
      twistCenter: '[0, 0]',
    }

    const normalized = normalizeExtrudeDialogArguments(source)

    expect(normalized).toMatchObject({
      extentType: 'toFace',
      directionMode: 'oneSide',
      length: undefined,
      to: selectedFace,
      symmetric: undefined,
      bidirectionalLength: undefined,
      direction: undefined,
      draftAngle: undefined,
      twistAngle: undefined,
      twistAngleStep: undefined,
      twistCenter: undefined,
    })
    expect(source.length).toBe('5')
  })
})
