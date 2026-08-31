import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'

/**
 * The `@settings(…)` annotation a KCL file carries, and who decides it.
 *
 * A KCL file can declare its own defaults — the unit its unsuffixed numbers mean,
 * the language version it was written against — in an inner attribute at the top:
 *
 * ```kcl
 * @settings(defaultLengthUnit = in, kclVersion = 2.0)
 * ```
 *
 * Both matter beyond formatting. The unit is what an unsuffixed `10` means, so a
 * file that does not say and is read by an app configured differently draws
 * different geometry. The version is what the language does with the file at all.
 *
 * Writing it is kcl-lib's job, not this app's: `change_default_units` and
 * `change_kcl_version` parse, edit the attribute and recast, so a file with a
 * comment above its annotation keeps the comment. This module is the *policy* —
 * which values a new file gets — with the two calls passed in as a port so the
 * policy can be tested without WASM.
 */

/**
 * The version every new file is written against.
 *
 * App-controlled, deliberately, and this is a decision rather than an oversight:
 * a project-level "which language version" setting is a thing to want, but a
 * project written against a version the app cannot execute is worse than no
 * setting at all. It becomes a preference when there is a second version worth
 * choosing.
 */
export const DEFAULT_KCL_VERSION = '2.0'

/**
 * The unit a file means when it says nothing.
 *
 * kcl-lib's own default, and the reason a new file in a millimetre project gets
 * no `defaultLengthUnit` at all: an annotation that repeats the default is noise
 * in every file, and the two cannot disagree.
 */
export const DEFAULT_LENGTH_UNIT: UnitLength = 'mm'

/** Every unit a length can be declared in, in the order a menu should show them. */
export const LENGTH_UNITS: readonly UnitLength[] = [
  'mm',
  'cm',
  'm',
  'in',
  'ft',
  'yd',
]

/** Spelled out, as the existing app spells them. */
export const LENGTH_UNIT_LABELS: Record<UnitLength, string> = {
  mm: 'Millimeters',
  cm: 'Centimeters',
  m: 'Meters',
  in: 'Inches',
  ft: 'Feet',
  yd: 'Yards',
}

/**
 * The two kcl-lib calls this needs, as a port.
 *
 * Both take and return whole files, and both take their argument as JSON because
 * that is how the WASM boundary spells an `Option<T>` — `null` is what removes an
 * annotation rather than setting one.
 */
export interface KclMetaWriter {
  change_default_units(code: string, lengthJson: string): string
  change_kcl_version(code: string, versionJson: string): string
}

/**
 * The declared unit, or null to remove the declaration.
 *
 * Removing is a real thing to want: a file with no declaration means "whatever
 * the project says", which is the right state for a file that should follow its
 * surroundings.
 */
export function withLengthUnit(
  writer: KclMetaWriter,
  source: string,
  unit: UnitLength | null
): string {
  return writer.change_default_units(source, JSON.stringify(unit))
}

/** The declared language version, or null to remove the declaration. */
export function withKclVersion(
  writer: KclMetaWriter,
  source: string,
  version: string | null
): string {
  return writer.change_kcl_version(source, JSON.stringify(version))
}

/**
 * What a brand-new KCL file says before anybody has typed in it.
 *
 * The version always, because that is what the language reads it as. The unit
 * only when it differs from kcl-lib's own default — and *that* is the important
 * case: without it, a file in an inch project would mean inches only for as long
 * as the app happened to be configured that way, and would silently become
 * millimetres for anybody else who opened it.
 *
 * Content that already exists is returned untouched. A file being copied in, or
 * a sample being written out, brings its own annotation and is not this policy's
 * business.
 */
export function newKclFile(
  writer: KclMetaWriter,
  options: { contents?: string; lengthUnit?: UnitLength } = {}
): string {
  const { contents, lengthUnit = DEFAULT_LENGTH_UNIT } = options

  if (contents !== undefined && contents.trim() !== '') return contents

  const withUnit =
    lengthUnit === DEFAULT_LENGTH_UNIT
      ? ''
      : withLengthUnit(writer, '', lengthUnit)

  return withKclVersion(writer, withUnit, DEFAULT_KCL_VERSION)
}
