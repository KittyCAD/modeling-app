import { DEFAULT_DEFAULT_ANGLE_UNIT } from 'lib/constants'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from 'lib/constants'

import { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'

import {
  changeKclSettings,
  unitAngleToUnitAng,
  unitLengthToUnitLen,
} from './wasm'

/**
 * Create a new KCL file with the given initial content and default length unit.
 * @returns KCL string
 */
export function newKclFile(
  initialContent: string | undefined,
  defaultLengthUnit: UnitLength
): string | Error {
  // If we're given initial content, we're loading a file that should already
  // have units in it.  Don't modify it.
  if (initialContent !== undefined) {
    return initialContent
  }
  // If the default length unit is the same as the default default length unit,
  // there's no need to add the attribute.
  if (defaultLengthUnit === DEFAULT_DEFAULT_LENGTH_UNIT) {
    return ''
  }

  return changeKclSettings('', {
    defaultLengthUnits: unitLengthToUnitLen(defaultLengthUnit),
    defaultAngleUnits: unitAngleToUnitAng(DEFAULT_DEFAULT_ANGLE_UNIT),
  })
}
