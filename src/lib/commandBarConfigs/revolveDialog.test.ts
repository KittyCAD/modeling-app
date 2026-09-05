import {
  getRevolveAxisMode,
  normalizeRevolveDialogArguments,
} from '@src/lib/commandBarConfigs/revolveDialog'
import { describe, expect, it } from 'vitest'

const selectedEdge = {
  graphSelections: [{ artifact: { type: 'segment' } }],
  otherSelections: [],
}

describe('Revolve dialog axis selection', () => {
  it('infers a missing reference type without overriding an explicit choice', () => {
    expect(getRevolveAxisMode({ axis: 'X' })).toBe('Axis')
    expect(getRevolveAxisMode({ edge: selectedEdge })).toBe('Edge')
    expect(getRevolveAxisMode({ axisOrEdge: 'Axis', edge: selectedEdge })).toBe(
      'Axis'
    )
    expect(getRevolveAxisMode({ axisOrEdge: 'Edge', axis: 'X' })).toBe('Edge')
  })

  it('clears an inactive edge while preserving the supplied KCL arguments', () => {
    const source = {
      axisOrEdge: 'Axis',
      axis: 'X',
      edge: selectedEdge,
      angle: '90deg',
      symmetric: false,
      bidirectionalAngle: '30deg',
    }

    expect(normalizeRevolveDialogArguments(source)).toEqual({
      ...source,
      edge: undefined,
    })
    expect(source.edge).toBe(selectedEdge)
  })

  it('clears an inactive sketch axis when an edge is selected', () => {
    expect(
      normalizeRevolveDialogArguments({
        axisOrEdge: 'Edge',
        axis: 'Y',
        edge: selectedEdge,
      })
    ).toEqual({
      axisOrEdge: 'Edge',
      axis: undefined,
      edge: selectedEdge,
    })
  })
})
