import {
  getHoleBottom,
  getHoleType,
  normalizeHoleDialogArguments,
} from '@src/lib/commandBarConfigs/holeDialog'
import { describe, expect, it } from 'vitest'

describe('Hole dialog modes', () => {
  it('infers missing modes from their dependent dimensions', () => {
    expect(getHoleType({})).toBe('simple')
    expect(getHoleType({ counterboreDepth: '1' })).toBe('counterbore')
    expect(getHoleType({ countersinkAngle: '90deg' })).toBe('countersink')
    expect(getHoleBottom({})).toBe('flat')
    expect(getHoleBottom({ drillPointAngle: '110deg' })).toBe('drill')
  })

  it('defaults to a simple flat blind hole and clears inactive dimensions', () => {
    const source = {
      holeBody: 'unsupported',
      holeType: 'simple',
      holeBottom: 'flat',
      counterboreDepth: '1',
      counterboreDiameter: '2',
      countersinkAngle: '90deg',
      countersinkDiameter: '2',
      countersinkHeadClearance: '0.25',
      drillPointAngle: '110deg',
    }

    expect(normalizeHoleDialogArguments(source)).toMatchObject({
      holeBody: 'blind',
      holeType: 'simple',
      holeBottom: 'flat',
      counterboreDepth: undefined,
      counterboreDiameter: undefined,
      countersinkAngle: undefined,
      countersinkDiameter: undefined,
      countersinkHeadClearance: undefined,
      drillPointAngle: undefined,
    })
    expect(source.counterboreDepth).toBe('1')
  })

  it('keeps only counterbore and drill dimensions when those modes are active', () => {
    expect(
      normalizeHoleDialogArguments({
        holeType: 'counterbore',
        holeBottom: 'drill',
        counterboreDepth: '1',
        counterboreDiameter: '2',
        countersinkAngle: '90deg',
        countersinkDiameter: '3',
        countersinkHeadClearance: '0.25',
        drillPointAngle: '110deg',
      })
    ).toMatchObject({
      counterboreDepth: '1',
      counterboreDiameter: '2',
      countersinkAngle: undefined,
      countersinkDiameter: undefined,
      countersinkHeadClearance: undefined,
      drillPointAngle: '110deg',
    })
  })

  it('keeps only countersink dimensions when countersink is active', () => {
    expect(
      normalizeHoleDialogArguments({
        holeType: 'countersink',
        holeBottom: 'flat',
        counterboreDepth: '1',
        counterboreDiameter: '2',
        countersinkAngle: '90deg',
        countersinkDiameter: '3',
        countersinkHeadClearance: '0.25',
        drillPointAngle: '110deg',
      })
    ).toMatchObject({
      counterboreDepth: undefined,
      counterboreDiameter: undefined,
      countersinkAngle: '90deg',
      countersinkDiameter: '3',
      countersinkHeadClearance: '0.25',
      drillPointAngle: undefined,
    })
  })
})
