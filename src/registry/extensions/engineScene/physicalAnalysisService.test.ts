import { beforeEach, describe, expect, it } from 'vitest'
import {
  PHYSICAL_ANALYSIS_STORAGE_KEY,
  parsePhysicalAnalysisPreferences,
  physicalAnalysisService,
} from './physicalAnalysisService'

const emptyPreferences = {
  lengthUnit: null,
  areaUnit: null,
  volumeUnit: null,
  massUnit: null,
  densityUnit: null,
  materialDensity: null,
}

describe('parsePhysicalAnalysisPreferences', () => {
  it('accepts a fully populated valid payload', () => {
    expect(
      parsePhysicalAnalysisPreferences({
        lengthUnit: 'in',
        areaUnit: 'in2',
        volumeUnit: 'usgal',
        massUnit: 'lb',
        densityUnit: 'lb:ft3',
        materialDensity: 490,
      })
    ).toEqual({
      lengthUnit: 'in',
      areaUnit: 'in2',
      volumeUnit: 'usgal',
      massUnit: 'lb',
      densityUnit: 'lb:ft3',
      materialDensity: 490,
    })
  })

  it('falls back to defaults for non-object input', () => {
    expect(parsePhysicalAnalysisPreferences(null)).toEqual(emptyPreferences)
    expect(parsePhysicalAnalysisPreferences('nope')).toEqual(emptyPreferences)
    expect(parsePhysicalAnalysisPreferences(42)).toEqual(emptyPreferences)
  })

  it('drops unit values that are not in their union', () => {
    expect(
      parsePhysicalAnalysisPreferences({
        lengthUnit: 'furlong',
        areaUnit: 'acre',
        volumeUnit: 'barrel',
        massUnit: 'stone',
        densityUnit: 'g:cm3',
      })
    ).toEqual(emptyPreferences)
  })

  it('drops densities the engine would refuse', () => {
    for (const materialDensity of [0, -1, Number.NaN, '7850', null]) {
      expect(
        parsePhysicalAnalysisPreferences({ materialDensity }).materialDensity
      ).toBeNull()
    }
    expect(
      parsePhysicalAnalysisPreferences({ materialDensity: 7850 })
        .materialDensity
    ).toBe(7850)
  })

  it('keeps valid fields when others are invalid', () => {
    expect(
      parsePhysicalAnalysisPreferences({
        lengthUnit: 'mm',
        areaUnit: 'nonsense',
        materialDensity: 1000,
      })
    ).toEqual({
      ...emptyPreferences,
      lengthUnit: 'mm',
      materialDensity: 1000,
    })
  })
})

describe('physicalAnalysisService persistence', () => {
  beforeEach(() => {
    globalThis.localStorage.clear()
    physicalAnalysisService.reloadPreferences()
    physicalAnalysisService.close()
  })

  it('round-trips preferences through localStorage', () => {
    physicalAnalysisService.setPreference('massUnit', 'kg')
    physicalAnalysisService.setPreference('materialDensity', 2700)

    physicalAnalysisService.reloadPreferences()

    expect(physicalAnalysisService.preferences.value).toEqual({
      ...emptyPreferences,
      massUnit: 'kg',
      materialDensity: 2700,
    })
  })

  it('recovers from malformed persisted JSON', () => {
    globalThis.localStorage.setItem(
      PHYSICAL_ANALYSIS_STORAGE_KEY,
      '{not valid json'
    )

    physicalAnalysisService.reloadPreferences()

    expect(physicalAnalysisService.preferences.value).toEqual(emptyPreferences)
  })

  it('discards persisted values that are no longer valid units', () => {
    globalThis.localStorage.setItem(
      PHYSICAL_ANALYSIS_STORAGE_KEY,
      JSON.stringify({ volumeUnit: 'hogshead', massUnit: 'g' })
    )

    physicalAnalysisService.reloadPreferences()

    expect(physicalAnalysisService.preferences.value).toEqual({
      ...emptyPreferences,
      massUnit: 'g',
    })
  })

  it('tracks open and close state', () => {
    expect(physicalAnalysisService.isOpen.value).toBe(false)
    physicalAnalysisService.open()
    expect(physicalAnalysisService.isOpen.value).toBe(true)
    physicalAnalysisService.close()
    expect(physicalAnalysisService.isOpen.value).toBe(false)
  })
})
