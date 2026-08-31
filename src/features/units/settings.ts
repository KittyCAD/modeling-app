import { optionsSetting } from '@src/contracts/settings'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import {
  DEFAULT_LENGTH_UNIT,
  LENGTH_UNITS,
  LENGTH_UNIT_LABELS,
} from '@src/lib/kcl/metaSettings'

/**
 * The unit this app works in.
 *
 * Overridable at both levels, and both readings are real: the user's is "what I
 * work in", the project's is "what this part is drawn in". A part drawn in inches
 * stays in inches when somebody who works in millimetres opens it, which is why
 * the project override wins — and why a new file in that project gets the unit
 * written into it rather than inheriting it from whoever happens to be looking.
 *
 * `base_unit` in the TOML, because that is what the Rust schema calls it. The
 * name here is the one the rest of the app uses.
 */
export const defaultLengthUnitSetting = optionsSetting<UnitLength>({
  id: 'modeling.defaultLengthUnit',
  section: 'modeling',
  title: 'Default length units',
  description:
    'The unit an unsuffixed number means, in files that do not declare one of their own. A new file in this project is given this unit explicitly, so it keeps its meaning wherever it is opened.',
  order: 0,
  defaultValue: DEFAULT_LENGTH_UNIT,
  options: LENGTH_UNITS.map((unit) => ({
    value: unit,
    label: LENGTH_UNIT_LABELS[unit],
    hint: unit,
  })),
  toml: ['settings', 'modeling', 'base_unit'],
})

export const unitsSettings = [defaultLengthUnitSetting]
