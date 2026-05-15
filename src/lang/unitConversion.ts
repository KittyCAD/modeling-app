import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'

/**
 * Convert a NumericSuffix string to UnitLength.
 * Returns null if the suffix is not a length unit.
 */
export function numericSuffixToUnitLength(
  suffix: NumericSuffix
): UnitLength | null {
  switch (suffix) {
    case 'Mm':
      return 'mm'
    case 'Cm':
      return 'cm'
    case 'M':
      return 'm'
    case 'Inch':
      return 'in'
    case 'Ft':
      return 'ft'
    case 'Yd':
      return 'yd'
    // non length units for type completeness
    case 'None':
    case 'Deg':
    case 'Rad':
    case 'Count':
    case 'Length':
    case 'Angle':
    case 'Unknown':
      return null
    default:
      const _exhaustiveCheck: never = suffix
      return _exhaustiveCheck
  }
}

export function unitLengthToNumericSuffix(unit: UnitLength): NumericSuffix {
  switch (unit) {
    case 'mm':
      return 'Mm'
    case 'cm':
      return 'Cm'
    case 'm':
      return 'M'
    case 'in':
      return 'Inch'
    case 'ft':
      return 'Ft'
    case 'yd':
      return 'Yd'
    default:
      const _exhaustiveCheck: never = unit
      return _exhaustiveCheck
  }
}

export function baseUnitToNumericSuffix(
  defaultLengthUnit?: UnitLength
): NumericSuffix {
  const currentUnit = defaultLengthUnit ?? DEFAULT_DEFAULT_LENGTH_UNIT
  return unitLengthToNumericSuffix(currentUnit)
}
