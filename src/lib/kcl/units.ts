import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'

/**
 * Lengths, in the one unit the engine actually uses.
 *
 * kcl-lib converts every length it sends with `to_mm()` and never tells the
 * engine otherwise, so the engine's world is millimetres no matter what the file
 * says. Anything that has to meet engine geometry — a camera position, a plane
 * origin, a sketch point about to be projected — passes through here first.
 *
 * Two vocabularies arrive: `NumericSuffix`, which is what a KCL number carries,
 * and `UnitLength`, which is what an artifact carries. They spell the same six
 * units differently, which is the entire reason this file exists rather than a
 * multiplication at each call site.
 */

const MILLIMETRES_PER: Record<UnitLength, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
  yd: 914.4,
}

/** The `UnitLength` a KCL numeric suffix means, or null when it means no length. */
export function lengthUnitOf(suffix: NumericSuffix): UnitLength | null {
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
    default:
      return null
  }
}

/**
 * A length in millimetres.
 *
 * A unit that names no length — `None`, `Count`, an angle — leaves the value
 * alone, and that is now the right answer rather than a hopeful one. Every
 * length kcl-lib reports has been resolved against the file's effective unit
 * during execution, and the app tells it what that is: the declared
 * `@settings(defaultLengthUnit)` if the file has one, else `base_unit` from the
 * project's or the user's preference. So a number arriving here with no length
 * unit is a number that is not a length.
 */
export function millimetres(
  value: number,
  unit: UnitLength | NumericSuffix | null | undefined
): number {
  if (!unit) return value

  const length =
    unit in MILLIMETRES_PER
      ? (unit as UnitLength)
      : lengthUnitOf(unit as NumericSuffix)
  return length ? value * MILLIMETRES_PER[length] : value
}

/**
 * The `NumericSuffix` for a unit written in a `@settings` annotation.
 *
 * KCL spells units one way in source and another in the numeric model — `in`
 * versus `Inch` — and this is the crossing. Null for anything unrecognised,
 * which a caller should read as "write no suffix" rather than as millimetres:
 * an unsuffixed number already means the file's default.
 */
export function suffixForUnitName(name: string | null): NumericSuffix | null {
  switch (name) {
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
      return null
  }
}

/**
 * A measurement as a person reads it.
 *
 * Degrees get their symbol, because an angle without one reads as a length.
 * Lengths get the bare number: the sketch is written in the file's own unit, so
 * repeating it on every label says the same thing over and over — and the label
 * is edited as a KCL *expression*, where a stray `mm` would change the meaning.
 */
export function formatMeasure(
  value: number,
  units: NumericSuffix | string
): string {
  const shown = Number.isInteger(value) ? `${value}` : `${value}`
  return units === 'Deg' ? `${shown}°` : shown
}

/**
 * The same measurement, as the text that would produce it.
 *
 * What goes into an edit field, which is not always what is shown: a degree
 * symbol is for reading, and typing it back into the file would not parse.
 */
export const editableMeasure = (value: number): string => `${value}`
