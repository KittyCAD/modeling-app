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
 * alone. That is a guess, and the honest version of it: such a number has
 * already been resolved against the file's default length unit by whoever
 * produced it, and this has no way to ask what that was. It is right for the
 * common case of a file in millimetres and wrong by a constant factor for a file
 * that sets `defaultLengthUnit` to something else, which is the bug to look for
 * if a sketch draws at the wrong scale.
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
