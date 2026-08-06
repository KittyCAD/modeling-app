import {
  getRevolveAxisMode,
  getRevolveDirectionMode,
  getRevolveExtentType,
  normalizeRevolveDialogArguments,
} from '@src/lib/commandBarConfigs/revolveDialog'
import { describe, expect, it } from 'vitest'

const selectedEdge = {
  graphSelections: [{ artifact: { type: 'segment' } }],
  otherSelections: [],
}

describe('Revolve dialog modes', () => {
  it('infers modes from existing KCL arguments', () => {
    expect(getRevolveAxisMode({ axis: 'X' })).toBe('Axis')
    expect(getRevolveAxisMode({ edge: selectedEdge })).toBe('Edge')
    expect(getRevolveExtentType({})).toBe('full')
    expect(getRevolveExtentType({ angle: '90deg' })).toBe('angle')
    expect(getRevolveDirectionMode({ angle: '90deg' })).toBe('oneSide')
    expect(getRevolveDirectionMode({ symmetric: true })).toBe('symmetric')
    expect(getRevolveDirectionMode({ bidirectionalAngle: '30deg' })).toBe(
      'twoSides'
    )
  })

  it('submits a full revolve without angle or direction arguments', () => {
    const source = {
      axisOrEdge: 'Axis',
      axis: 'X',
      edge: selectedEdge,
      extentType: 'full',
      directionMode: 'twoSides',
      angle: '90deg',
      symmetric: true,
      bidirectionalAngle: '30deg',
    }

    expect(normalizeRevolveDialogArguments(source)).toMatchObject({
      axisOrEdge: 'Axis',
      axis: 'X',
      edge: undefined,
      extentType: 'full',
      directionMode: 'oneSide',
      angle: undefined,
      symmetric: undefined,
      bidirectionalAngle: undefined,
    })
    expect(source.angle).toBe('90deg')
  })

  it('maps angular direction modes onto compatible KCL arguments', () => {
    expect(
      normalizeRevolveDialogArguments({
        extentType: 'angle',
        directionMode: 'symmetric',
        angle: '90deg',
        bidirectionalAngle: '30deg',
      })
    ).toMatchObject({
      symmetric: true,
      bidirectionalAngle: undefined,
    })

    expect(
      normalizeRevolveDialogArguments({
        extentType: 'angle',
        directionMode: 'twoSides',
        angle: '90deg',
        symmetric: true,
        bidirectionalAngle: '30deg',
      })
    ).toMatchObject({
      symmetric: undefined,
      bidirectionalAngle: '30deg',
    })

    expect(
      normalizeRevolveDialogArguments({
        extentType: 'angle',
        directionMode: 'oneSide',
        angle: '90deg',
        symmetric: true,
        bidirectionalAngle: '30deg',
      })
    ).toMatchObject({
      symmetric: undefined,
      bidirectionalAngle: undefined,
    })
  })

  it('clears the inactive axis representation', () => {
    expect(
      normalizeRevolveDialogArguments({
        axisOrEdge: 'Edge',
        axis: 'Y',
        edge: selectedEdge,
        extentType: 'angle',
      })
    ).toMatchObject({
      axis: undefined,
      edge: selectedEdge,
    })
  })
})
