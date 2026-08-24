import type {
  UnitArea,
  UnitDensity,
  UnitLength,
  UnitMass,
  UnitVolume,
} from '@kittycad/lib'
import { baseUnits } from '@src/lib/settings/settingsTypes'

/**
 * Option lists double as runtime validators for values restored from
 * localStorage, so they have to stay exhaustive over each unit union.
 */
export const unitLengthOptions: readonly UnitLength[] = [
  'mm',
  'cm',
  'm',
  'in',
  'ft',
  'yd',
]

export const unitAreaOptions: readonly UnitArea[] = [
  'mm2',
  'cm2',
  'dm2',
  'm2',
  'km2',
  'in2',
  'ft2',
  'yd2',
]

export const unitVolumeOptions: readonly UnitVolume[] = [
  'mm3',
  'cm3',
  'm3',
  'in3',
  'ft3',
  'yd3',
  'ml',
  'l',
  'usfloz',
  'usgal',
]

export const unitMassOptions: readonly UnitMass[] = ['g', 'kg', 'lb']

export const unitDensityOptions: readonly UnitDensity[] = ['kg:m3', 'lb:ft3']

/** Density is analysis specific; area and volume labels live in measurementUtils. */
export const unitDensityLabels: Record<UnitDensity, string> = {
  'kg:m3': 'kg/m\u00b3',
  'lb:ft3': 'lb/ft\u00b3',
}

export function isMetricLengthUnit(unit: UnitLength): boolean {
  return (baseUnits.metric as readonly string[]).includes(unit)
}

export function getDefaultMassUnit(lengthUnit: UnitLength): UnitMass {
  return isMetricLengthUnit(lengthUnit) ? 'g' : 'lb'
}

export function getDefaultDensityUnit(lengthUnit: UnitLength): UnitDensity {
  return isMetricLengthUnit(lengthUnit) ? 'kg:m3' : 'lb:ft3'
}

/** Steel, as a recognizable starting point in either unit system. */
const defaultMaterialDensityByUnit: Record<UnitDensity, number> = {
  'kg:m3': 7850,
  'lb:ft3': 490,
}

export function getDefaultMaterialDensity(densityUnit: UnitDensity): number {
  return defaultMaterialDensityByUnit[densityUnit]
}

/** 1 lb/ft3 expressed in kg/m3. */
const kgPerM3PerLbPerFt3 = 16.018463373960142

/**
 * Keeps an entered density physically meaningful when the density unit
 * changes, so switching units cannot silently turn steel into something a
 * thousand times denser.
 */
export function convertMaterialDensity(
  value: number,
  fromUnit: UnitDensity,
  toUnit: UnitDensity
): number {
  if (fromUnit === toUnit) {
    return value
  }

  return fromUnit === 'kg:m3'
    ? value / kgPerM3PerLbPerFt3
    : value * kgPerM3PerLbPerFt3
}

export function isValidMaterialDensity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
