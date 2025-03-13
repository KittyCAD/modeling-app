import { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import {
  changeKclSettings,
  DEFAULT_DEFAULT_ANGLE_UNIT,
  unitAngleToUnitAng,
  unitLengthToUnitLen,
} from './wasm'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from 'lib/settings/settingsTypes'

/**
 * Create a new KCL file with the given initial content and default length unit.
 */
export function newKclFile(
  initialContent: string,
  defaultLengthUnit: UnitLength
): string | Error {
  // If the default length unit is the same as the default default length unit,
  // there's no need to add the attribute.
  if (defaultLengthUnit === DEFAULT_DEFAULT_LENGTH_UNIT) {
    return initialContent
  }

  return changeKclSettings(initialContent, {
    defaultLengthUnits: unitLengthToUnitLen(defaultLengthUnit),
    defaultAngleUnits: unitAngleToUnitAng(DEFAULT_DEFAULT_ANGLE_UNIT),
    stdPath: null,
  })
}
