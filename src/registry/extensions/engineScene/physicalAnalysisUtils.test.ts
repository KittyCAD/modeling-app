import type { UnitLength } from '@kittycad/lib'
import { describe, expect, it } from 'vitest'
import { getAreaUnit, getVolumeUnit } from './measurementUtils'
import {
  convertMaterialDensity,
  getDefaultDensityUnit,
  getDefaultMassUnit,
  getDefaultMaterialDensity,
  isMetricLengthUnit,
  isValidMaterialDensity,
  unitAreaOptions,
  unitDensityLabels,
  unitDensityOptions,
  unitLengthOptions,
  unitMassOptions,
  unitVolumeOptions,
} from './physicalAnalysisUtils'

const allLengthUnits: UnitLength[] = ['mm', 'cm', 'm', 'in', 'ft', 'yd']

describe('physicalAnalysisUtils', () => {
  it('classifies every length unit as metric or imperial', () => {
    expect(allLengthUnits.filter(isMetricLengthUnit)).toEqual(['mm', 'cm', 'm'])
    expect(allLengthUnits.filter((unit) => !isMetricLengthUnit(unit))).toEqual([
      'in',
      'ft',
      'yd',
    ])
  })

  it('defaults mass and density units to match the length unit system', () => {
    for (const unit of allLengthUnits) {
      const isMetric = isMetricLengthUnit(unit)
      expect(getDefaultMassUnit(unit)).toBe(isMetric ? 'g' : 'lb')
      expect(getDefaultDensityUnit(unit)).toBe(isMetric ? 'kg:m3' : 'lb:ft3')
    }
  })

  it('seeds a positive steel density for both density units', () => {
    expect(getDefaultMaterialDensity('kg:m3')).toBe(7850)
    expect(getDefaultMaterialDensity('lb:ft3')).toBe(490)
    for (const unit of unitDensityOptions) {
      expect(isValidMaterialDensity(getDefaultMaterialDensity(unit))).toBe(true)
    }
  })

  it('offers a dropdown option for every unit the seeding can produce', () => {
    for (const unit of allLengthUnits) {
      expect(unitLengthOptions).toContain(unit)
      expect(unitAreaOptions).toContain(getAreaUnit(unit))
      expect(unitVolumeOptions).toContain(getVolumeUnit(unit))
      expect(unitMassOptions).toContain(getDefaultMassUnit(unit))
      expect(unitDensityOptions).toContain(getDefaultDensityUnit(unit))
    }
  })

  it('labels every density option with a superscript', () => {
    for (const unit of unitDensityOptions) {
      expect(unitDensityLabels[unit]).toBeTruthy()
    }
    expect(unitDensityLabels['kg:m3']).toBe('kg/m\u00b3')
    expect(unitDensityLabels['lb:ft3']).toBe('lb/ft\u00b3')
  })

  it('converts densities between the two density units', () => {
    expect(convertMaterialDensity(7850, 'kg:m3', 'kg:m3')).toBe(7850)
    // Steel is ~7850 kg/m3 and ~490 lb/ft3.
    expect(convertMaterialDensity(7850, 'kg:m3', 'lb:ft3')).toBeCloseTo(490, 0)
    expect(convertMaterialDensity(490, 'lb:ft3', 'kg:m3')).toBeCloseTo(7849, 0)
  })

  it('round-trips a density through both unit conversions', () => {
    const roundTripped = convertMaterialDensity(
      convertMaterialDensity(2700, 'kg:m3', 'lb:ft3'),
      'lb:ft3',
      'kg:m3'
    )
    expect(roundTripped).toBeCloseTo(2700, 9)
  })

  it('rejects densities that the engine would refuse', () => {
    expect(isValidMaterialDensity(7850)).toBe(true)
    expect(isValidMaterialDensity(0.5)).toBe(true)
    expect(isValidMaterialDensity(0)).toBe(false)
    expect(isValidMaterialDensity(-1)).toBe(false)
    expect(isValidMaterialDensity(Number.NaN)).toBe(false)
    expect(isValidMaterialDensity(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isValidMaterialDensity('7850')).toBe(false)
    expect(isValidMaterialDensity(null)).toBe(false)
  })
})
